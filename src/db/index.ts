import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";
import { env } from "@/lib/env";

/**
 * Two ways to store data:
 * - DATABASE_URL set: an external PostgreSQL server (several app instances can share it).
 * - DATABASE_URL empty: PostgreSQL embedded in the app (PGlite), kept in DATA_DIR/postgres.
 *   Nothing else to install, but only ONE process may open it: the website. Scripts that need
 *   the database refuse to run while the website has it open.
 */
export type DB = NodePgDatabase<typeof schema>;
type G = { __pePool?: pg.Pool; __peDb?: DB; __pePglite?: PGlite; __peLock?: string };
const g = globalThis as unknown as G;

export const isEmbeddedDb = () => !env().DATABASE_URL.trim();
export const embeddedDbDir = () => path.resolve(env().DATA_DIR, "postgres");

export function pool(): pg.Pool {
  if (isEmbeddedDb()) throw new Error("pool() is only available with an external DATABASE_URL");
  if (!g.__pePool) {
    g.__pePool = new pg.Pool({ connectionString: env().DATABASE_URL, max: 15, idleTimeoutMillis: 30000 });
    g.__pePool.on("error", () => { /* surfaced on next query */ });
  }
  return g.__pePool;
}

function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Kernel start time of a process (Linux), so a reused PID isn't mistaken for the old owner. */
function startedAt(pid: number): string {
  try { return fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ")[19] ?? ""; } catch { return ""; }
}

type LockInfo = { pid: number; host: string; started: string };
const HEARTBEAT_MS = 10_000;

/** Is the process that wrote this lock still running? */
function lockHeld(lock: string, info: LockInfo): boolean {
  if (info.host === os.hostname()) {
    // Same machine or container: check the process itself (and that its PID wasn't reused).
    return info.pid !== process.pid && alive(info.pid) && (!info.started || startedAt(info.pid) === info.started);
  }
  // Another container or machine sharing the folder: trust the owner's heartbeat.
  try { return Date.now() - fs.statSync(lock).mtimeMs < 3 * HEARTBEAT_MS; } catch { return false; }
}

/** One process at a time: the embedded database is a folder of files, not a server. */
function takeLock(dir: string) {
  const lock = path.join(path.dirname(dir), "postgres.lock");
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  let info: LockInfo | null = null;
  try {
    const raw = fs.readFileSync(lock, "utf8").trim();
    info = raw.startsWith("{") ? JSON.parse(raw) as LockInfo : { pid: Number(raw), host: os.hostname(), started: "" };
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  if (info && lockHeld(lock, info)) {
    throw new Error(`The embedded database (${dir}) is open in another process (pid ${info.pid} on ${info.host}), usually the website. ` +
      "Stop it first, run the command inside the website's container (docker compose exec app …), " +
      "or set DATABASE_URL to use a PostgreSQL server that several processes can share.");
  }
  const mine: LockInfo = { pid: process.pid, host: os.hostname(), started: startedAt(process.pid) };
  fs.writeFileSync(lock, JSON.stringify(mine));
  g.__peLock = lock;
  // Heartbeat, so a process in another container can tell the lock is live.
  const beat = setInterval(() => { try { const t = new Date(); fs.utimesSync(lock, t, t); } catch { /* gone */ } }, HEARTBEAT_MS);
  beat.unref?.();
  const release = () => {
    clearInterval(beat);
    try { if ((JSON.parse(fs.readFileSync(lock, "utf8")) as LockInfo).pid === process.pid) fs.unlinkSync(lock); } catch { /* gone */ }
  };
  process.once("exit", release);
}

function embedded(): DB {
  const dir = embeddedDbDir();
  takeLock(dir);
  // Loaded lazily so deployments with an external database never touch the WebAssembly build.
  const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  const { drizzle: drizzleLite } = require("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
  g.__pePglite = new PGlite(dir);
  // Same query builder and schema; the node-postgres type covers both.
  return drizzleLite(g.__pePglite, { schema }) as unknown as DB;
}

export function db(): DB {
  if (!g.__peDb) g.__peDb = isEmbeddedDb() ? embedded() : drizzle(pool(), { schema });
  return g.__peDb;
}

export async function closeDb() {
  if (g.__pePool) await g.__pePool.end();
  if (g.__pePglite) {
    // Closing while it's still opening can hang; let it finish opening first.
    await g.__pePglite.waitReady.catch(() => undefined);
    await g.__pePglite.close().catch(() => undefined);
  }
  if (g.__peLock) { try { fs.unlinkSync(g.__peLock); } catch { /* gone */ } }
  g.__pePool = undefined; g.__pePglite = undefined; g.__peDb = undefined; g.__peLock = undefined;
}

/** Applies database migrations (drizzle/), for either kind of database. */
export async function migrateDb(folder = "./drizzle") {
  if (isEmbeddedDb()) {
    db();
    const { migrate } = require("drizzle-orm/pglite/migrator") as typeof import("drizzle-orm/pglite/migrator");
    await migrate(db() as never, { migrationsFolder: folder });
  } else {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db(), { migrationsFolder: folder });
  }
}

export { schema };
