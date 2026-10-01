import http from "node:http";
import handler from "./api/wma.js";

const port = Number(process.env.PORT || 3000);

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve(undefined);
      const type = String(req.headers["content-type"] || "");
      if (type.includes("application/json")) {
        try { return resolve(JSON.parse(data)); } catch (error) { return reject(error); }
      }
      resolve(data);
    });
    req.on("error", reject);
  });
}

function enhanceResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (value) => {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    res.end(JSON.stringify(value));
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    req.query = Object.fromEntries(url.searchParams.entries());
    req.body = await parseBody(req);

    if (url.pathname === "/health") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, service: "wikimaster-auto" }));
      return;
    }

    if (url.pathname === "/pair.js") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");
      res.end(`
(async()=>{try{
const B="https://wikimaster-auto-api-production.up.railway.app";
const C=(prompt("Code affiché dans WikiMaster Auto :")||"").trim().toUpperCase();
if(!C)throw new Error("Code manquant");
const K="sb-cyrxjeppjqsxxjayfrur-auth-token",cs={};
document.cookie.split(";").forEach(p=>{const i=p.indexOf("=");if(i>0)cs[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim())});
let ks=Object.keys(cs).filter(k=>k===K||k.startsWith(K+"."));
ks.sort((a,b)=>{const na=Number(a.split(".").pop()),nb=Number(b.split(".").pop());return(Number.isFinite(na)?na:0)-(Number.isFinite(nb)?nb:0)});
if(!ks.length)throw new Error("Session WikiMasters introuvable. Vérifie que tu es connecté.");
let raw=ks.map(k=>cs[k]).join("");
if(raw.startsWith("base64-")){raw=raw.slice(7).replace(/-/g,"+").replace(/_/g,"/");raw+="=".repeat((4-raw.length%4)%4);raw=atob(raw)}
let s=JSON.parse(raw);if(Array.isArray(s))s=s[0];
if(!s?.refresh_token)throw new Error("Refresh token introuvable");
const r=await fetch(B+"/api/wma?action=pair-complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pairCode:C,refreshToken:s.refresh_token})});
const j=await r.json().catch(()=>({}));
if(!r.ok)throw new Error(j.error||("HTTP "+r.status));
alert("WikiMaster Auto connecté ✓ Tu peux revenir sur ton téléphone.");
}catch(e){alert("WikiMaster Auto : "+e.message)}})();
`);
      return;
    }

    if (url.pathname !== "/api/wma") {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    await handler(req, enhanceResponse(res));
  } catch (error) {
    console.error("HTTP server error:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "internal_error" }));
  }
});

async function runSchedulerTick() {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/wma?action=cron`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(90_000)
      }
    );
    if (!response.ok) {
      console.error("Scheduler tick failed:", response.status, await response.text());
    }
  } catch (error) {
    console.error("Scheduler tick error:", error.message);
  }
}

async function testPasswordWithoutCaptcha() {
  try {
    const key = process.env.SUPABASE_ANON_KEY || "";
    const response = await fetch(
      "https://cyrxjeppjqsxxjayfrur.supabase.co/auth/v1/token?grant_type=password",
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: "definitely-not-a-real-user@example.invalid",
          password: "definitely-wrong-password"
        })
      }
    );
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}
    console.log("WMA_PASSWORD_NO_CAPTCHA", JSON.stringify({
      status: response.status,
      error: body?.error || null,
      errorCode: body?.error_code || null,
      msg: body?.msg || body?.message || null
    }));
  } catch (error) {
    console.error("WMA_PASSWORD_NO_CAPTCHA_ERROR", error.message);
  }
}

async function scanWikiMastersTurnstile() {
  try {
    const response = await fetch("https://www.wiki-masters.com/login", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const html = await response.text();
    const scriptPaths = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi)]
      .map((match) => match[1])
      .slice(0, 40);

    const found = new Set();
    const inspect = (text) => {
      for (const match of text.matchAll(/0x[0-9A-Za-z_-]{20,}/g)) found.add(match[0]);
      for (const match of text.matchAll(/sitekey["'\s:=]+["']([^"']{10,120})["']/gi)) found.add(match[1]);
    };
    inspect(html);

    for (const src of scriptPaths) {
      try {
        const url = new URL(src, "https://www.wiki-masters.com").toString();
        const jsResponse = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        const js = await jsResponse.text();
        if (/turnstile|captcha|sitekey/i.test(js)) inspect(js);
      } catch {}
    }

    console.log("WMA_TURNSTILE_SCAN", JSON.stringify({
      status: response.status,
      scriptCount: scriptPaths.length,
      sitekeys: [...found]
    }));
  } catch (error) {
    console.error("WMA_TURNSTILE_SCAN_ERROR", error.message);
  }
}

async function probeAuthEndpoints() {
  const base = "https://cyrxjeppjqsxxjayfrur.supabase.co";
  const key = process.env.SUPABASE_ANON_KEY || "";
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };

  try {
    const r = await fetch(base + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers,
      body: JSON.stringify({ refresh_token: "invalid-probe-token" })
    });
    const t = await r.text();
    console.log("WMA_AUTH_ENDPOINT_PROBE", JSON.stringify({
      endpoint: "refresh",
      status: r.status,
      contentType: r.headers.get("content-type"),
      preview: t.slice(0, 120).replace(/\s+/g, " ")
    }));
  } catch (e) {
    console.log("WMA_AUTH_ENDPOINT_PROBE", JSON.stringify({
      endpoint: "refresh",
      error: e.message
    }));
  }

  try {
    const r = await fetch(base + "/auth/v1/otp?redirect_to=https%3A%2F%2Ftdi-rosa.github.io%2Fauto_booster%2F", {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: "nobody-wikimaster-auto-test@example.invalid",
        create_user: false
      })
    });
    const t = await r.text();
    console.log("WMA_AUTH_ENDPOINT_PROBE", JSON.stringify({
      endpoint: "otp",
      status: r.status,
      contentType: r.headers.get("content-type"),
      preview: t.slice(0, 160).replace(/\s+/g, " ")
    }));
  } catch (e) {
    console.log("WMA_AUTH_ENDPOINT_PROBE", JSON.stringify({
      endpoint: "otp",
      error: e.message
    }));
  }
}

async function logAuthCapabilities() {
  try {
    const response = await fetch("https://cyrxjeppjqsxxjayfrur.supabase.co/auth/v1/settings", {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY || "",
        Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY || ""}`
      }
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!data) {
      console.log("WMA_AUTH_CAPS_RAW", JSON.stringify({
        status: response.status,
        contentType: response.headers.get("content-type"),
        preview: text.slice(0, 180).replace(/\s+/g, " ")
      }));
      return;
    }
    console.log("WMA_AUTH_CAPS", JSON.stringify({
      status: response.status,
      disableSignup: data.disable_signup ?? null,
      mailerAutoconfirm: data.mailer_autoconfirm ?? null,
      external: data.external ?? null,
      captchaEnabled: data.captcha_enabled ?? null,
      captchaProvider: data.captcha_provider ?? null,
      phoneAutoconfirm: data.phone_autoconfirm ?? null
    }));
  } catch (error) {
    console.error("WMA_AUTH_CAPS_ERROR", error.message);
  }
}

server.listen(port, "0.0.0.0", () => {
  console.log(`WikiMaster Auto backend listening on :${port}`);
  setTimeout(logAuthCapabilities, 1500);
  setTimeout(probeAuthEndpoints, 1800);
  setTimeout(scanWikiMastersTurnstile, 2500);
  setTimeout(testPasswordWithoutCaptcha, 3500);
  setTimeout(runSchedulerTick, 15_000);
  setInterval(runSchedulerTick, 5 * 60_000);
});
