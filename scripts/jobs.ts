/** Retention and housekeeping worker. `npm run jobs` loops every 10 minutes; `--once` runs one pass. */
import "./load-env";
import { closeDb } from "@/db";
import { closeRedis } from "@/lib/redis";
import { runRetention } from "@/lib/retention";
import { sweepCalls } from "@/lib/calls";

const once = process.argv.includes("--once");
const EVERY_MS = 10 * 60_000;

async function pass() {
  try { console.log(JSON.stringify({ at: new Date().toISOString(), ...(await runRetention()) })); }
  catch (e) { console.error("retention run failed", e instanceof Error ? e.message : e); }
}

async function main() {
  await pass();
  if (once) { await closeDb(); await closeRedis(); return; }
  let stopping = false;
  const stop = async () => { stopping = true; await closeDb(); await closeRedis(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  // Missed in-app calls must be noticed within seconds even if nobody has the app open.
  setInterval(() => { sweepCalls(true).catch((e) => console.error("call sweep failed", e instanceof Error ? e.message : e)); }, 10_000);
  while (!stopping) { await new Promise((r) => setTimeout(r, EVERY_MS)); await pass(); }
}
main();
