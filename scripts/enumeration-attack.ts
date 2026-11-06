/**
 * Simulated enumeration/scraping campaign against a RUNNING server (staging or local).
 * One attacker account guesses random codes as fast as it can. Pass condition (acceptance):
 * more than 99.9% of attempts are blocked by budgets/lockouts, and zero guesses succeed.
 *
 *   npm run attack:enumerate -- --attempts=10000 --concurrency=50
 */
import { closeDb } from "@/db";
import { closeRedis } from "@/lib/redis";
import { DEV_CAPTCHA_TOKEN } from "@/lib/captcha";
import { randomCrockford, groupCode } from "@/lib/crypto";
import { env } from "@/lib/env";
import { arg, fixtureCaller, post, BASE } from "./script-helpers";

async function main() {
  if (env().APP_ENV === "production") throw new Error("Refusing to run an attack simulation against production configuration.");
  const attempts = Number(arg("attempts", "10000")), concurrency = Number(arg("concurrency", "50"));
  const { cookie } = await fixtureCaller("attacker_" + Date.now().toString(36));
  const tally: Record<string, number> = {};
  let done = 0, success = 0;
  const t0 = Date.now();
  async function worker() {
    while (done < attempts) {
      done++;
      const short = Math.random() < 0.5;
      const code = short ? groupCode(randomCrockford(10), 5) : groupCode(randomCrockford(16));
      const r = await post("/api/gate/start", { code, captcha: DEV_CAPTCHA_TOKEN }, cookie);
      const k = r.data?.status ?? `http_${r.status}`;
      tally[k] = (tally[k] ?? 0) + 1;
      if (k === "ok") success++;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const evaluated = tally.unavailable ?? 0;
  const blocked = attempts - evaluated - success;
  const blockedPct = (blocked / attempts) * 100;
  const pass = blockedPct > 99.9 && success === 0;
  console.log(JSON.stringify({ target: BASE, attempts, concurrency, seconds: Math.round((Date.now() - t0) / 1000), outcomes: tally,
    evaluatedAgainstTokenStore: evaluated, successfulGuesses: success, blockedPercent: Number(blockedPct.toFixed(3)), pass }, null, 2));
  await closeDb(); await closeRedis();
  process.exit(pass ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await closeDb(); await closeRedis(); process.exit(2); });
