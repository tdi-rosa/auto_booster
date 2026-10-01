import webpush from "web-push";
import {
  ALLOWED_INTERVALS,
  PWA_ORIGINS,
  WIKI_ORIGINS,
  env
} from "../lib/config.js";
import { decryptJson, encryptJson } from "../lib/security.js";
import {
  acquireClientLock,
  appendHistory,
  authenticateClient,
  bearerFor,
  consumePairing,
  createPairing,
  dueClients,
  findPairing,
  getClient,
  historyCount,
  readHistory,
  releaseClientLock,
  saveClient,
  scheduleClient,
  unscheduleClient
} from "../lib/storage.js";
import {
  openAllAvailablePacks,
  validateRefreshToken
} from "../lib/wiki.js";

const RARITY_RANK = { C: 0, PC: 1, R: 2, SR: 3, UR: 4, L: 5 };

function setCors(res, origin, allowedOrigins) {
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
}

function send(res, status, body) {
  res.status(status).json(body);
}

function originAllowed(req, res, allowed) {
  const origin = req.headers.origin || "";
  setCors(res, origin, allowed);
  return !origin || allowed.has(origin);
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) return JSON.parse(req.body);
  return {};
}

function publicClient(client, count = null) {
  return {
    connected: Boolean(client?.paired),
    userId: client?.userId || null,
    email: client?.email || null,
    settings: client?.settings || null,
    connectedAt: client?.connectedAt || null,
    lastRunAt: client?.lastRunAt || null,
    nextRunAt: client?.nextRunAt || null,
    lastError: client?.lastError || null,
    historyCount: count
  };
}

function configurePush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    publicKey,
    privateKey
  );
  return true;
}

async function sendPullNotification(client, cards) {
  if (!client.pushSubscription || !configurePush()) return;
  const minRank = Number(client.settings?.minRank ?? 4);
  const notable = cards.filter(
    (card) => (RARITY_RANK[card.rarity] ?? 0) >= minRank
  );
  if (!notable.length) return;

  const title = notable.length === 1
    ? `Nouvelle carte ${notable[0].rarity}`
    : `${notable.length} cartes remarquables obtenues`;

  const body = notable
    .slice(0, 3)
    .map((card) => `${card.rarity} · ${card.title}`)
    .join(" • ");

  try {
    await webpush.sendNotification(
      client.pushSubscription,
      JSON.stringify({
        title,
        body,
        url: "https://tdi-rosa.github.io/auto_booster/"
      })
    );
  } catch (error) {
    const code = Number(error?.statusCode || 0);
    if (code === 404 || code === 410) {
      client.pushSubscription = null;
      await saveClient(client);
    }
  }
}

async function runClient(clientId, { manual = false } = {}) {
  const lock = await acquireClientLock(clientId);
  if (!lock) {
    return { ok: false, skipped: true, reason: "already_running" };
  }

  try {
    const client = await getClient(clientId);
    if (!client?.paired || !client.encryptedSession) {
      await unscheduleClient(clientId);
      return { ok: false, skipped: true, reason: "not_paired" };
    }

    const storedSession = decryptJson(client.encryptedSession);
    const result = await openAllAvailablePacks(storedSession);

    await appendHistory(client.id, result.cards);

    const now = Date.now();
    client.encryptedSession = encryptJson(result.session);
    client.lastRunAt = now;
    client.lastError = null;
    client.nextRunAt = client.settings?.enabled
      ? now + Number(client.settings.intervalMinutes || 100) * 60_000
      : null;

    await saveClient(client);
    await scheduleClient(client);
    await sendPullNotification(client, result.cards);

    return {
      ok: true,
      manual,
      packsOpened: result.packsOpened,
      packsRemaining: result.packsRemaining,
      cards: result.cards,
      nextRunAt: client.nextRunAt
    };
  } catch (error) {
    const client = await getClient(clientId);
    if (client) {
      client.lastRunAt = Date.now();
      client.lastError =
        error instanceof Error ? error.message : String(error);
      if (client.settings?.enabled) {
        client.nextRunAt = Date.now() + 15 * 60_000;
      }
      await saveClient(client);
      await scheduleClient(client);
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await releaseClientLock(clientId, lock);
  }
}

export default async function handler(req, res) {
  const action = String(req.query?.action || "");

  if (req.method === "OPTIONS") {
    const allowed = action === "pair-complete" ? WIKI_ORIGINS : PWA_ORIGINS;
    setCors(res, req.headers.origin || "", allowed);
    res.status(204).end();
    return;
  }

  try {
    if (action === "health") {
      return send(res, 200, { ok: true, service: "wikimaster-auto" });
    }

    if (action === "vapid-key") {
      if (!originAllowed(req, res, PWA_ORIGINS)) {
        return send(res, 403, { error: "forbidden" });
      }
      return send(res, 200, {
        publicKey: process.env.VAPID_PUBLIC_KEY || null
      });
    }

    if (action === "pair-start") {
      if (req.method !== "POST" || !originAllowed(req, res, PWA_ORIGINS)) {
        return send(res, 403, { error: "forbidden" });
      }

      const pairing = await createPairing();
      return send(res, 200, {
        pairCode: pairing.pairCode,
        expiresInSeconds: pairing.expiresInSeconds,
        credential: bearerFor(pairing.clientId, pairing.clientToken)
      });
    }

    if (action === "pair-complete") {
      console.log("PAIR_COMPLETE_ATTEMPT", {
        method: req.method,
        origin: req.headers.origin || "",
        userAgent: req.headers["user-agent"] || ""
      });
      if (req.method !== "POST" || !originAllowed(req, res, WIKI_ORIGINS)) {
        return send(res, 403, { error: "forbidden" });
      }

      const body = await readJson(req);
      const pairCode = String(body.pairCode || "").trim().toUpperCase();
      const clientId = await findPairing(pairCode);
      if (!clientId) {
        return send(res, 404, { error: "pairing_expired" });
      }

      const verified = await validateRefreshToken(String(body.refreshToken || ""));
      const client = await getClient(clientId);
      if (!client) {
        return send(res, 404, { error: "client_not_found" });
      }

      client.paired = true;
      client.encryptedSession = encryptJson(verified.session);
      client.userId = verified.userId;
      client.email = verified.email;
      client.connectedAt = Date.now();
      client.lastError = null;

      await saveClient(client);
      await consumePairing(pairCode);

      console.log("PAIR_COMPLETE_SUCCESS", { clientId, userId: verified.userId || null });
      return send(res, 200, { ok: true });
    }

    if (action === "cron") {
      if (req.method !== "POST") {
        return send(res, 405, { error: "method_not_allowed" });
      }

      const expected = env("CRON_SECRET");
      const auth = String(req.headers.authorization || "");
      if (auth !== `Bearer ${expected}`) {
        return send(res, 401, { error: "unauthorized" });
      }

      const ids = await dueClients(Date.now(), 20);
      const results = [];
      for (const clientId of ids) {
        results.push({
          clientId,
          ...(await runClient(clientId))
        });
      }
      return send(res, 200, { processed: results.length, results });
    }

    if (!originAllowed(req, res, PWA_ORIGINS)) {
      return send(res, 403, { error: "forbidden" });
    }

    const client = await authenticateClient(req);
    if (!client) {
      return send(res, 401, { error: "unauthorized" });
    }

    if (action === "status" && req.method === "GET") {
      return send(
        res,
        200,
        publicClient(client, await historyCount(client.id))
      );
    }

    if (action === "history" && req.method === "GET") {
      const offset = Math.max(0, Number(req.query?.offset || 0));
      const limit = Math.min(
        200,
        Math.max(1, Number(req.query?.limit || 100))
      );

      const [items, count] = await Promise.all([
        readHistory(client.id, offset, limit),
        historyCount(client.id)
      ]);

      return send(res, 200, { items, count, offset, limit });
    }

    if (action === "settings" && req.method === "POST") {
      const body = await readJson(req);
      const settings = { ...client.settings };

      if (typeof body.enabled === "boolean") {
        settings.enabled = body.enabled;
      }

      if (body.intervalMinutes !== undefined) {
        const interval = Number(body.intervalMinutes);
        if (!ALLOWED_INTERVALS.has(interval)) {
          return send(res, 400, { error: "invalid_interval" });
        }
        settings.intervalMinutes = interval;
      }

      if (body.minRank !== undefined) {
        const rank = Number(body.minRank);
        if (!Number.isInteger(rank) || rank < 0 || rank > 5) {
          return send(res, 400, { error: "invalid_rarity" });
        }
        settings.minRank = rank;
      }

      client.settings = settings;
      client.nextRunAt = settings.enabled && client.paired
        ? Date.now() + Number(settings.intervalMinutes) * 60_000
        : null;

      await saveClient(client);
      await scheduleClient(client);

      return send(
        res,
        200,
        publicClient(client, await historyCount(client.id))
      );
    }

    if (action === "push-subscribe" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.subscription?.endpoint) {
        return send(res, 400, { error: "invalid_subscription" });
      }
      client.pushSubscription = body.subscription;
      await saveClient(client);
      return send(res, 200, { ok: true });
    }

    if (action === "open-now" && req.method === "POST") {
      if (!client.paired) {
        return send(res, 409, { error: "not_connected" });
      }
      const result = await runClient(client.id, { manual: true });
      return send(res, result.ok ? 200 : 502, result);
    }

    if (action === "disconnect" && req.method === "POST") {
      client.paired = false;
      client.encryptedSession = null;
      client.userId = null;
      client.email = null;
      client.settings.enabled = false;
      client.nextRunAt = null;
      client.lastError = null;
      client.pushSubscription = null;

      await saveClient(client);
      await unscheduleClient(client.id);

      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: "unknown_action" });
  } catch (error) {
    console.error(
      "WikiMaster Auto backend error:",
      error instanceof Error ? error.message : String(error)
    );
    return send(res, 500, { error: "internal_error" });
  }
}
