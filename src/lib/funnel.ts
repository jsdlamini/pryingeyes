import { sql } from "drizzle-orm";
import { db } from "@/db";
import { redis } from "./redis";
import { env } from "./env";
import { hmacHex } from "./crypto";

export type FunnelCounter = "opened" | "signup_started" | "signup_completed" | "reached" | "loop_code_created";

/** A salt that changes daily so the per-browser dedup hashes can't be joined across days. */
function dailySalt(): string {
  const day = new Date().toISOString().slice(0, 10);
  return hmacHex(Buffer.from(env().TOKEN_PEPPER, "base64"), `funnel:${day}`);
}

/** Increment a counter for a code (one cheap upsert; never blocks the request that calls it). */
export async function bumpFunnel(codeId: string, counter: FunnelCounter): Promise<void> {
  try {
    await db().execute(sql`INSERT INTO funnel_daily (code_id, day, counter, count) VALUES (${codeId}, current_date, ${counter}, 1)
      ON CONFLICT (code_id, day, counter) DO UPDATE SET count = funnel_daily.count + 1`);
  } catch { /* best-effort */ }
}

/** Count a page-view-style event once per browser per day, via a salted hash kept in Redis. */
export async function bumpOpenedOnce(codeId: string, fingerprint: string): Promise<void> {
  try {
    const key = `funnel:${hmacHex(Buffer.from(dailySalt(), "utf8"), `${codeId}:${fingerprint}`).slice(0, 32)}`;
    const seen = await redis().get(key);
    if (seen) return;
    await redis().set(key, "1", "EX", 86400);
    await bumpFunnel(codeId, "opened");
  } catch { /* best-effort */ }
}

/** Count a first message or call once per (code, caller), so repeat chats don't inflate it. */
export async function bumpReached(codeId: string, callerId: string): Promise<void> {
  try {
    const key = `funnel:reached:${codeId}:${callerId}`;
    const seen = await redis().get(key);
    if (seen) return;
    await redis().set(key, "1", "EX", 7776000); // ~90 days, covers the 30-day view
    await bumpFunnel(codeId, "reached");
  } catch { /* best-effort */ }
}

/** Attribute a counter to the code named in a local `next` path (e.g. /t/<code>). */
export async function bumpFromNext(next: string | null | undefined, counter: FunnelCounter): Promise<void> {
  if (!next) return;
  const m = next.match(/^\/t\/([0-9A-Za-z-]+)/);
  if (!m) return;
  try {
    const { findByCode } = await import("./tokens");
    const token = await findByCode(m[1]);
    if (token) await bumpFunnel(token.id, counter);
  } catch { /* best-effort */ }
}

/** Totals for a code over the last N days: { counter: total }. */
export async function funnelFor(codeId: string, days: number): Promise<Record<string, number>> {
  const rows = await db().execute(sql`SELECT counter, sum(count)::int AS total FROM funnel_daily
    WHERE code_id = ${codeId} AND day > current_date - ${days} * interval '1 day' GROUP BY counter`);
  const out: Record<string, number> = { opened: 0, signup_started: 0, signup_completed: 0, reached: 0, loop_code_created: 0 };
  for (const r of rows.rows as { counter: string; total: number }[]) out[r.counter] = r.total;
  return out;
}

/** Totals across all codes, for the admin view. */
export async function funnelTotals(days: number): Promise<Record<string, number>> {
  const rows = await db().execute(sql`SELECT counter, sum(count)::int AS total FROM funnel_daily
    WHERE day > current_date - ${days} * interval '1 day' GROUP BY counter`);
  const out: Record<string, number> = { opened: 0, signup_started: 0, signup_completed: 0, reached: 0, loop_code_created: 0 };
  for (const r of rows.rows as { counter: string; total: number }[]) out[r.counter] = r.total;
  return out;
}
