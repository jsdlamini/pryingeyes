/**
 * Decode-gate latency under load, against a RUNNING server. Each virtual caller runs the full
 * Tier 1 path (start → outcome). Reports p50/p95/p99 for /api/gate/start, including the fixed
 * 200 ms response floor. Target: p95 under 300 ms at ten times projected peak.
 *
 * Budgets would (correctly) throttle a load test, so run the server with raised budgets:
 *   RL_IP_PER_HOUR=10000000 RL_CALLER_PER_DAY=10000000 RL_CALLER_TOKEN_PER_DAY=10000000 RL_TOKEN_PER_DAY=10000000 npm start
 *   npm run load:test -- --rps=50 --seconds=30
 */
import { closeDb } from "@/db";
import { closeRedis } from "@/lib/redis";
import { DEV_CAPTCHA_TOKEN } from "@/lib/captcha";
import { env } from "@/lib/env";
import { arg, fixtureCaller, fixtureOwnerToken, percentile, post, BASE } from "./script-helpers";

async function main() {
  if (env().APP_ENV === "production") throw new Error("Refusing to load-test a production configuration.");
  const rps = Number(arg("rps", "50")), seconds = Number(arg("seconds", "30")), callers = Number(arg("callers", "40"));
  const tokens = await Promise.all(Array.from({ length: 10 }, () => fixtureOwnerToken(1)));
  const pool = await Promise.all(Array.from({ length: callers }, () => fixtureCaller()));
  const lat: number[] = [], statuses: Record<string, number> = {};
  const total = rps * seconds, interval = 1000 / rps;
  const t0 = Date.now();
  const inflight: Promise<void>[] = [];
  for (let i = 0; i < total; i++) {
    const c = pool[i % pool.length], t = tokens[i % tokens.length];
    inflight.push((async () => {
      const r = await post("/api/gate/start", { code: t.link, captcha: DEV_CAPTCHA_TOKEN }, c.cookie, `10.200.${(i >> 8) & 255}.${i & 255}`);
      lat.push(r.ms);
      const k = r.data?.status ?? `http_${r.status}`;
      statuses[k] = (statuses[k] ?? 0) + 1;
    })());
    const wait = t0 + (i + 1) * interval - Date.now();
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
  }
  await Promise.all(inflight);
  const p95 = percentile(lat, 95);
  const out = { target: BASE, requests: total, targetRps: rps, achievedRps: Number((total / ((Date.now() - t0) / 1000)).toFixed(1)), statuses,
    ms: { p50: Math.round(percentile(lat, 50)), p95: Math.round(p95), p99: Math.round(percentile(lat, 99)), max: Math.round(Math.max(...lat)) },
    floorMs: env().GATE_FLOOR_MS, pass: p95 < 300 && (statuses.ok ?? 0) > 0 };
  console.log(JSON.stringify(out, null, 2));
  await closeDb(); await closeRedis();
  process.exit(out.pass ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await closeDb(); await closeRedis(); process.exit(2); });
