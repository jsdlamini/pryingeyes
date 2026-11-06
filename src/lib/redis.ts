import Redis from "ioredis";
import { env } from "./env";
import { MemoryRedis } from "./memory-redis";

/**
 * REDIS_URL set: a Redis server (needed when several copies of the app run).
 * REDIS_URL empty: an in-memory store inside the website process (see memory-redis.ts).
 */
const g = globalThis as unknown as { __peRedis?: Redis };

export const isMemoryRedis = () => !env().REDIS_URL.trim();

export function redis(): Redis {
  if (!g.__peRedis) {
    if (isMemoryRedis()) {
      g.__peRedis = new MemoryRedis() as unknown as Redis;
    } else {
      g.__peRedis = new Redis(env().REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: true, lazyConnect: false });
      g.__peRedis.on("error", () => { /* reported by callers */ });
    }
  }
  return g.__peRedis;
}

export async function closeRedis() {
  if (g.__peRedis) await g.__peRedis.quit().catch(() => undefined);
  g.__peRedis = undefined;
}
