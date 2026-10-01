import {
  COOKIE_BASE,
  SITE_URL,
  SUPABASE_URL,
  env
} from "./config.js";
import { jwtPayload } from "./security.js";

const TRANSIENT = new Set([409, 425, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function anonKey() {
  return env("SUPABASE_ANON_KEY");
}

export async function loginWithPassword(email, password, captchaToken) {
  if (!email || !password || !captchaToken) {
    throw new Error("Identifiants ou CAPTCHA manquants");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: anonKey(),
        Authorization: `Bearer ${anonKey()}`,
        "Content-Type": "application/json;charset=UTF-8",
        "X-Client-Info": "supabase-ssr/0.9.0 createBrowserClient",
        "X-Supabase-Api-Version": "2024-01-01"
      },
      body: JSON.stringify({
        grant_type: "password",
        email,
        password,
        gotrue_meta_security: { captcha_token: captchaToken }
      }),
      signal: AbortSignal.timeout(25_000)
    }
  );

  const text = await response.text();
  if (!response.ok) {
    let message = text.slice(0, 220);
    try {
      const parsed = JSON.parse(text);
      message = parsed.msg || parsed.error_description || parsed.message || message;
    } catch {}
    throw new Error(`Connexion WikiMasters refusée (${response.status}) : ${message}`);
  }

  const session = JSON.parse(text);
  if (!session.access_token || !session.refresh_token) {
    throw new Error("WikiMasters a renvoyé une session incomplète");
  }

  return validateRefreshToken(session.refresh_token);
}

export async function refreshSession(refreshToken) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: {
        apikey: anonKey(),
        "Content-Type": "application/json",
        "X-Client-Info": "wikimaster-auto/0.1"
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(20_000)
    }
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase refresh failed (${response.status}): ${text.slice(0, 160)}`);
  }

  const session = JSON.parse(text);
  if (!session.access_token || !session.refresh_token) {
    throw new Error("Supabase refresh returned an incomplete session");
  }
  return session;
}

export function buildWikiCookie(session) {
  const value =
    "base64-" +
    Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const chunkSize = 3180;

  if (value.length <= chunkSize) {
    return `${COOKIE_BASE}=${value}`;
  }

  const chunks = [];
  for (let i = 0; i < value.length; i += chunkSize) {
    chunks.push(value.slice(i, i + chunkSize));
  }
  return chunks
    .map((chunk, index) => `${COOKIE_BASE}.${index}=${chunk}`)
    .join("; ");
}

async function wikiFetch(path, session, init = {}) {
  return fetch(`${SITE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Cookie: buildWikiCookie(session),
      ...(init.headers || {})
    },
    signal: AbortSignal.timeout(25_000)
  });
}

export async function validateSession(session) {
  if (!session?.access_token || !session?.refresh_token) {
    throw new Error("Session WikiMasters invalide");
  }

  const test = await wikiFetch("/api/wikibidous", session);
  if (!test.ok) {
    throw new Error(`Session WikiMasters refusée (${test.status})`);
  }

  const payload = jwtPayload(session.access_token);
  return {
    session,
    userId: session.user?.id || payload?.sub || null,
    email: session.user?.email || payload?.email || null
  };
}

export async function validateRefreshToken(refreshToken) {
  if (!refreshToken || typeof refreshToken !== "string") {
    throw new Error("Refresh token WikiMasters invalide");
  }

  const session = await refreshSession(refreshToken);
  const test = await wikiFetch("/api/wikibidous", session);
  if (!test.ok) {
    throw new Error(`Session WikiMasters refusée (${test.status})`);
  }

  const payload = jwtPayload(session.access_token);
  return {
    session,
    userId: session.user?.id || payload?.sub || null,
    email: session.user?.email || payload?.email || null
  };
}

async function openOnePack(session) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await wikiFetch("/api/packs/open", session, {
        method: "POST"
      });

      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch {}

      if (response.ok) return body || {};

      if (!TRANSIENT.has(response.status)) {
        throw new Error(
          `WikiMasters HTTP ${response.status}: ${body?.error || text.slice(0, 160)}`
        );
      }

      const retryAfter = Number(response.headers.get("retry-after") || 0);
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 700 * (attempt + 1));
      lastError = new Error(`WikiMasters transient HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(700 * (attempt + 1));
    }
  }

  throw lastError || new Error("Pack opening failed");
}

function sessionExpiresSoon(session, marginSeconds = 120) {
  const payload = jwtPayload(session?.access_token);
  const expiresAt = Number(session?.expires_at || payload?.exp || 0);
  if (!expiresAt) return true;
  return expiresAt <= Math.floor(Date.now() / 1000) + marginSeconds;
}

export async function openAllAvailablePacks(storedSession) {
  let session = storedSession;

  // Supabase refresh tokens rotate. Refreshing on every scheduler tick burns the
  // token unnecessarily and can invalidate another client using the same account.
  // Keep the current access token until it is close to expiry.
  if (sessionExpiresSoon(storedSession)) {
    session = await refreshSession(storedSession.refresh_token);
  }

  const pulledAt = Date.now();
  const cards = [];
  let packsOpened = 0;
  let packsRemaining = null;

  for (let index = 0; index < 10; index += 1) {
    const result = await openOnePack(session);
    packsOpened += 1;

    if (Array.isArray(result.cards)) {
      for (const card of result.cards) {
        cards.push({
          cardId: card.id || null,
          title: card.wikipedia_title || card.title || "Carte",
          wikipediaUrl: card.wikipedia_url || null,
          imageUrl: card.image_url || null,
          category: card.category || null,
          rarity: String(card.rarity || "C").toUpperCase(),
          atk: card.atk ?? null,
          def: card.def ?? null,
          pulledAt
        });
      }
    }

    const remaining = Number(result.packs_remaining);
    packsRemaining = Number.isFinite(remaining) ? remaining : null;
    if (packsRemaining === 0) break;
    await sleep(850);
  }

  return {
    session,
    cards,
    packsOpened,
    packsRemaining
  };
}
