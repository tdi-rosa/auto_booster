import { createClient } from "redis";
import { DEFAULT_INTERVAL_MINUTES, env } from "./config.js";
import { randomPairCode, randomToken, safeEqualHex, sha256 } from "./security.js";

const PREFIX = "wma";
const DUE_KEY = `${PREFIX}:due`;

let redisInstance;
let connecting;

export async function redis() {
  if (redisInstance?.isOpen) return redisInstance;
  if (connecting) return connecting;

  redisInstance = createClient({ url: env("REDIS_URL") });
  redisInstance.on("error", (error) => {
    console.error("Redis error:", error.message);
  });

  connecting = redisInstance.connect().then(() => redisInstance);
  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

const clientKey = (id) => `${PREFIX}:client:${id}`;
const pairKey = (code) => `${PREFIX}:pair:${code}`;
const historyKey = (id) => `${PREFIX}:history:${id}`;
const lockKey = (id) => `${PREFIX}:lock:${id}`;

async function jsonGet(key) {
  const value = await (await redis()).get(key);
  return value ? JSON.parse(value) : null;
}

async function jsonSet(key, value) {
  await (await redis()).set(key, JSON.stringify(value));
}

export async function createPairing() {
  const db = await redis();
  const clientId = randomToken(12);
  const clientToken = randomToken(32);
  let pairCode = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = randomPairCode();
    const ok = await db.set(pairKey(candidate), clientId, { NX: true, EX: 600 });
    if (ok) {
      pairCode = candidate;
      break;
    }
  }
  if (!pairCode) throw new Error("Could not allocate pairing code");

  const now = Date.now();
  await jsonSet(clientKey(clientId), {
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
  return jsonGet(clientKey(clientId));
}

export async function saveClient(client) {
  client.updatedAt = Date.now();
  await jsonSet(clientKey(client.id), client);
}

export async function findPairing(pairCode) {
  if (!pairCode) return null;
  return (await redis()).get(pairKey(String(pairCode).trim().toUpperCase()));
}

export async function consumePairing(pairCode) {
  await (await redis()).del(pairKey(String(pairCode).trim().toUpperCase()));
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
  const db = await redis();
  if (!client.paired || !client.settings?.enabled || !client.nextRunAt) {
    await db.zRem(DUE_KEY, client.id);
    return;
  }
  await db.zAdd(DUE_KEY, [{ score: Number(client.nextRunAt), value: client.id }]);
}

export async function unscheduleClient(clientId) {
  await (await redis()).zRem(DUE_KEY, clientId);
}

export async function dueClients(now = Date.now(), count = 20) {
  return (await redis()).zRangeByScore(DUE_KEY, 0, now, {
    LIMIT: { offset: 0, count }
  });
}

export async function acquireClientLock(clientId, ttlSeconds = 120) {
  const value = randomToken(16);
  const ok = await (await redis()).set(lockKey(clientId), value, {
    NX: true,
    EX: ttlSeconds
  });
  return ok ? value : null;
}

export async function releaseClientLock(clientId, value) {
  const db = await redis();
  const key = lockKey(clientId);
  const current = await db.get(key);
  if (current === value) await db.del(key);
}

export async function appendHistory(clientId, cards) {
  if (!cards?.length) return;
  await (await redis()).lPush(
    historyKey(clientId),
    cards.map((card) => JSON.stringify(card))
  );
}

export async function readHistory(clientId, offset = 0, limit = 100) {
  const end = offset + limit - 1;
  const rows = await (await redis()).lRange(historyKey(clientId), offset, end);
  return rows.map((row) => {
    try { return JSON.parse(row); } catch { return null; }
  }).filter(Boolean);
}

export async function historyCount(clientId) {
  return (await redis()).lLen(historyKey(clientId));
}
