import { Redis } from "@upstash/redis";
import { DEFAULT_INTERVAL_MINUTES } from "./config.js";
import { randomPairCode, randomToken, safeEqualHex, sha256 } from "./security.js";

const PREFIX = "wma";
const DUE_KEY = `${PREFIX}:due`;

let redisInstance;

export function redis() {
  if (redisInstance) return redisInstance;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Upstash Redis environment variables are missing");
  redisInstance = new Redis({ url, token, enableTelemetry: false });
  return redisInstance;
}

const clientKey = (id) => `${PREFIX}:client:${id}`;
const pairKey = (code) => `${PREFIX}:pair:${code}`;
const historyKey = (id) => `${PREFIX}:history:${id}`;
const lockKey = (id) => `${PREFIX}:lock:${id}`;

export async function createPairing() {
  const db = redis();
  const clientId = randomToken(12);
  const clientToken = randomToken(32);
  let pairCode = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = randomPairCode();
    const ok = await db.set(pairKey(candidate), clientId, { nx: true, ex: 600 });
    if (ok) {
      pairCode = candidate;
      break;
    }
  }
  if (!pairCode) throw new Error("Could not allocate pairing code");

  const now = Date.now();
  await db.set(clientKey(clientId), {
    id: clientId,
    tokenHash: sha256(clientToken),
    paired: false,
    encryptedSession: null,
    userId: null,
    email: null,
    settings: {
      enabled: false,
      intervalMinutes: DEFAULT_INTERVAL_MINUTES,
      minRank: 4
    },
    pushSubscription: null,
    createdAt: now,
    updatedAt: now,
    connectedAt: null,
    lastRunAt: null,
    nextRunAt: null,
    lastError: null
  });

  return {
    clientId,
    clientToken,
    pairCode,
    expiresInSeconds: 600
  };
}

export async function getClient(clientId) {
  return redis().get(clientKey(clientId));
}

export async function saveClient(client) {
  client.updatedAt = Date.now();
  await redis().set(clientKey(client.id), client);
}

export async function findPairing(pairCode) {
  if (!pairCode) return null;
  return redis().get(pairKey(String(pairCode).trim().toUpperCase()));
}

export async function consumePairing(pairCode) {
  await redis().del(pairKey(String(pairCode).trim().toUpperCase()));
}

export async function authenticateClient(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;

  const raw = auth.slice(7).trim();
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;

  const clientId = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  const client = await getClient(clientId);
  if (!client || !safeEqualHex(client.tokenHash, sha256(token))) return null;
  return client;
}

export function bearerFor(clientId, clientToken) {
  return `${clientId}.${clientToken}`;
}

export async function scheduleClient(client) {
  const db = redis();
  if (!client.paired || !client.settings?.enabled || !client.nextRunAt) {
    await db.zrem(DUE_KEY, client.id);
    return;
  }
  await db.zadd(DUE_KEY, { score: client.nextRunAt, member: client.id });
}

export async function unscheduleClient(clientId) {
  await redis().zrem(DUE_KEY, clientId);
}

export async function dueClients(now = Date.now(), count = 20) {
  return redis().zrange(DUE_KEY, "-inf", now, {
    byScore: true,
    offset: 0,
    count
  });
}

export async function acquireClientLock(clientId, ttlSeconds = 120) {
  const value = randomToken(16);
  const ok = await redis().set(lockKey(clientId), value, {
    nx: true,
    ex: ttlSeconds
  });
  return ok ? value : null;
}

export async function releaseClientLock(clientId, value) {
  const db = redis();
  const current = await db.get(lockKey(clientId));
  if (current === value) await db.del(lockKey(clientId));
}

export async function appendHistory(clientId, cards) {
  if (!cards?.length) return;
  await redis().lpush(
    historyKey(clientId),
    ...cards.map((card) => JSON.stringify(card))
  );
}

export async function readHistory(clientId, offset = 0, limit = 100) {
  const end = offset + limit - 1;
  const rows = await redis().lrange(historyKey(clientId), offset, end);
  return rows.map((row) => {
    if (typeof row !== "string") return row;
    try { return JSON.parse(row); } catch { return null; }
  }).filter(Boolean);
}

export async function historyCount(clientId) {
  return redis().llen(historyKey(clientId));
}
