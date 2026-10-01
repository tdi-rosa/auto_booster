import { chromium } from "playwright";
import { COOKIE_BASE } from "./config.js";
import { randomToken } from "./security.js";

const sessions = new Map();
const TTL_MS = 10 * 60_000;

function decodeSession(cookies) {
  const parts = cookies
    .filter((cookie) => cookie.name === COOKIE_BASE || cookie.name.startsWith(COOKIE_BASE + "."))
    .sort((a, b) => {
      const ai = Number(a.name.split(".").pop());
      const bi = Number(b.name.split(".").pop());
      return (Number.isFinite(ai) ? ai : 0) - (Number.isFinite(bi) ? bi : 0);
    });

  if (!parts.length) return null;
  let raw = parts.map((cookie) => cookie.value).join("");
  try { raw = decodeURIComponent(raw); } catch {}

  if (raw.startsWith("base64-")) {
    raw = raw.slice(7).replace(/-/g, "+").replace(/_/g, "/");
    raw += "=".repeat((4 - raw.length % 4) % 4);
    raw = Buffer.from(raw, "base64").toString("utf8");
  }

  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === "object") {
    parsed = parsed[0];
  }
  return parsed?.access_token && parsed?.refresh_token ? parsed : null;
}

async function closeSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  try { await session.browser.close(); } catch {}
}

function scheduleCleanup(id) {
  setTimeout(() => closeSession(id), TTL_MS + 5_000).unref?.();
}

export async function startBrowserLogin(clientId) {
  for (const [id, session] of sessions) {
    if (session.clientId === clientId) await closeSession(id);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "fr-FR",
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
  });
  const page = await context.newPage();
  await page.goto("https://www.wiki-masters.com/login", {
    waitUntil: "domcontentloaded",
    timeout: 30_000
  });

  const id = randomToken(18);
  sessions.set(id, {
    id,
    clientId,
    browser,
    context,
    page,
    createdAt: Date.now()
  });
  scheduleCleanup(id);
  return { id, width: 390, height: 844, expiresInSeconds: 600 };
}

function owned(id, clientId) {
  const session = sessions.get(id);
  if (!session || session.clientId !== clientId) return null;
  if (Date.now() - session.createdAt > TTL_MS) {
    closeSession(id);
    return null;
  }
  return session;
}

export async function fillBrowserCredentials(id, clientId, email, password) {
  const session = owned(id, clientId);
  if (!session) throw new Error("browser_session_expired");

  const { page } = session;
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
}

export async function browserScreenshot(id, clientId) {
  const session = owned(id, clientId);
  if (!session) throw new Error("browser_session_expired");

  const image = await session.page.screenshot({
    type: "jpeg",
    quality: 72,
    fullPage: false
  });
  const cookies = await session.context.cookies("https://www.wiki-masters.com");
  const auth = decodeSession(cookies);

  return {
    imageBase64: image.toString("base64"),
    width: 390,
    height: 844,
    url: session.page.url(),
    connected: Boolean(auth),
    auth
  };
}

export async function browserClick(id, clientId, x, y) {
  const session = owned(id, clientId);
  if (!session) throw new Error("browser_session_expired");
  const px = Math.max(0, Math.min(389, Number(x)));
  const py = Math.max(0, Math.min(843, Number(y)));
  await session.page.mouse.click(px, py);
  await session.page.waitForTimeout(350);
}

export async function finishBrowserLogin(id, clientId) {
  const session = owned(id, clientId);
  if (!session) throw new Error("browser_session_expired");

  const cookies = await session.context.cookies("https://www.wiki-masters.com");
  const auth = decodeSession(cookies);
  if (!auth) return null;

  await closeSession(id);
  return auth;
}

export async function cancelBrowserLogin(id, clientId) {
  const session = owned(id, clientId);
  if (!session) return;
  await closeSession(id);
}
