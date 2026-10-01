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
  setTimeout(scanWikiMastersTurnstile, 2500);
  setTimeout(testPasswordWithoutCaptcha, 3500);
  setTimeout(runSchedulerTick, 15_000);
  setInterval(runSchedulerTick, 5 * 60_000);
});
