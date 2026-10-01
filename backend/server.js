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

server.listen(port, "0.0.0.0", () => {
  console.log(`WikiMaster Auto backend listening on :${port}`);
  setTimeout(runSchedulerTick, 15_000);
  setInterval(runSchedulerTick, 5 * 60_000);
});
