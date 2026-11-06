/**
 * Everything the website needs when it starts, so `npm start` is the only command:
 * check the settings, bring the database up to date, name the first admins, and run the
 * background jobs (expiring codes and messages, missed calls) inside the website process.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { embeddedDbDir, isEmbeddedDb, migrateDb } from "@/db";
import { isMemoryRedis } from "@/lib/redis";
import { grantConfiguredAdmins } from "@/lib/bootstrap-admins";
import { runRetention } from "@/lib/retention";
import { sweepCalls } from "@/lib/calls";

const g = globalThis as unknown as { __peBooted?: Promise<void> };

export function boot() {
  g.__peBooted ??= start();
  return g.__peBooted;
}

/**
 * The built-in database's data is encrypted with the keys in .env. Remember a fingerprint of those
 * keys beside the data, and refuse to start if they ever change (e.g. a lost .env regenerated):
 * the old data would be unreadable and new data would be mixed in with it.
 */
function checkKeysMatchData() {
  const e = env();
  const fp = crypto.createHash("sha256").update([e.MASTER_KEK, e.TOKEN_PEPPER, e.BLIND_INDEX_KEY, e.SECRETS_HMAC_KEY].join("|")).digest("hex").slice(0, 16);
  const file = path.join(path.dirname(embeddedDbDir()), "keys.fingerprint");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const known = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
  if (!known) {
    // First start, or data from before fingerprints existed: these keys belong to it from now on.
    fs.writeFileSync(file, fp);
    return;
  }
  if (known !== fp) {
    throw new Error(`The keys in .env don't match the data in ${path.dirname(embeddedDbDir())}.\n` +
      "That data was written with different keys. Restore the .env that belongs to it (from your backup).\n" +
      "Only if you mean to start over: remove that data (for Docker, the pryingeyes_pe-data volume), then start again.");
  }
}

async function start() {
  const e = env();   // throws, listing every problem, if the settings aren't safe for APP_ENV
  if (isEmbeddedDb()) checkKeysMatchData();
  await migrateDb();
  await grantConfiguredAdmins().catch((x) => console.error("ADMIN_EMAILS:", x instanceof Error ? x.message : x));
  console.log(`PryingEyes ready: ${e.APP_ENV} at ${e.APP_URL}; database ${isEmbeddedDb() ? "built in" : "PostgreSQL server"}; cache ${isMemoryRedis() ? "built in" : "Redis server"}`);
  if (e.BACKGROUND_JOBS === "off") return;
  const pass = () => runRetention().catch((x) => console.error("retention run failed", x instanceof Error ? x.message : x));
  void pass();
  setInterval(pass, 10 * 60_000).unref();
  // Missed in-app calls must be noticed within seconds even if nobody has the app open.
  setInterval(() => { sweepCalls(true).catch((x) => console.error("call sweep failed", x instanceof Error ? x.message : x)); }, 10_000).unref();
}
