/** Clears rate-limit counters on a development Redis so repeated local runs aren't throttled. */
import fs from "node:fs";
import Redis from "ioredis";

export default async function globalSetup() {
  const env: Record<string, string> = {};
  if (fs.existsSync(".env")) for (const l of fs.readFileSync(".env", "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
  if ((env.APP_ENV ?? "development") !== "development") return;
  if (!env.REDIS_URL?.trim()) return;   // built-in cache: it starts empty every time the website starts
  const r = new Redis(env.REDIS_URL);
  for (const pattern of ["rl:*", "lock:*", "lockcount:*"]) {
    let cursor = "0";
    do { const [c, keys] = await r.scan(cursor, "MATCH", pattern, "COUNT", 500); cursor = c; if (keys.length) await r.del(...keys); } while (cursor !== "0");
  }
  await r.quit();
}
