/**
 * Handle generation. Handles are what the people you contact see, so a generated handle is
 * deliberately random and never derived from your email, name or phone number.
 * Format: adjective_noun + 2 digits, e.g. "quiet_heron_42" (≈ 330,000 combinations before the
 * fallback adds more digits).
 */
import crypto from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { HttpError } from "./errors";

const ADJECTIVES = [
  "amber", "bold", "brave", "bright", "calm", "clever", "cosmic", "crisp", "daring", "dawn", "eager", "easy", "fair", "fancy",
  "gentle", "glad", "golden", "grand", "happy", "honest", "humble", "jolly", "keen", "kind", "lively", "lucky", "lunar", "merry",
  "mighty", "misty", "noble", "polite", "proud", "quick", "quiet", "rapid", "ready", "royal", "rustic", "sharp", "shiny", "silent",
  "silver", "simple", "smart", "snowy", "solar", "steady", "sunny", "swift", "tidy", "tranquil", "true", "vivid", "warm", "wise",
  "witty", "young", "zesty", "zippy",
];
const NOUNS = [
  "acacia", "antelope", "baobab", "badger", "bee", "buffalo", "canyon", "cedar", "cheetah", "comet", "crane", "delta", "eagle",
  "falcon", "fern", "finch", "fox", "gazelle", "gecko", "giraffe", "harbor", "hawk", "heron", "hippo", "ibis", "impala", "jacana",
  "kestrel", "kudu", "lark", "leopard", "lily", "lion", "lotus", "marula", "meadow", "meerkat", "mesa", "nyala", "oryx", "otter",
  "owl", "palm", "pangolin", "pebble", "plover", "protea", "quail", "raven", "reed", "river", "robin", "savanna", "sparrow",
  "springbok", "stork", "summit", "sunbird", "valley", "zebra",
];

const pick = <T>(xs: readonly T[]) => xs[crypto.randomInt(xs.length)];
const candidate = (digits: number) =>
  `${pick(ADJECTIVES)}_${pick(NOUNS)}_${crypto.randomInt(10 ** (digits - 1), 10 ** digits)}`;

export async function isHandleTaken(handle: string): Promise<boolean> {
  const r = await db().select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.handle}) = ${handle.toLowerCase()}`);
  return r.length > 0;
}

/** A handle that is free right now. Checks a batch at once; widens the number if a batch is all taken. */
export async function suggestHandle(): Promise<string> {
  for (const digits of [2, 2, 3, 4, 6]) {
    const batch = [...new Set(Array.from({ length: 8 }, () => candidate(digits)))];
    const taken = new Set((await db().select({ h: schema.users.handle }).from(schema.users)
      .where(inArray(sql`lower(${schema.users.handle})`, batch))).map((r) => r.h.toLowerCase()));
    const free = batch.find((h) => !taken.has(h));
    if (free) return free;
  }
  return `user_${crypto.randomBytes(6).toString("hex")}`;
}

/** Thrown when a chosen handle is taken; carries a fresh suggestion the UI can drop straight in. */
export async function handleTakenError() {
  return new HttpError(409, "handle_taken", "That handle is taken — we've suggested another.", { suggestion: await suggestHandle() });
}

/** True for a Postgres unique violation on the handle index. */
export function isHandleConflict(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const c = err?.cause ?? err;
  return c?.code === "23505" && String(c?.constraint ?? "").includes("users_handle");
}

/**
 * Best-effort cleanup of a typed handle: lower-case, spaces/hyphens → "_", drop disallowed
 * characters, trim to 24, must start with a letter or digit. Returns null if nothing usable is
 * left. Anything containing "@" is refused outright — it is almost always an email that browser
 * autofill put in the box, and a handle must never reveal an email.
 */
export function sanitizeHandle(raw: string | null | undefined): string | null {
  if (!raw || raw.includes("@")) return null;
  const h = raw.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_.]/g, "")
    .replace(/^[^a-z0-9]+/, "").slice(0, 24).replace(/[_.]+$/, "");
  return h.length >= 3 ? h : null;
}

export const HANDLE_RULE = "Handle: use 3–24 letters, numbers, underscores or dots, starting with a letter or number (no @ or spaces).";

/** Validates a handle the person typed. Invalid → 400 invalid_handle with a usable suggestion. */
export async function parseChosenHandle(raw: string | null | undefined): Promise<string | null> {
  if (!raw?.trim()) return null;
  const h = raw.trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9_.]{2,23}$/.test(h)) return h;
  const cleaned = sanitizeHandle(raw);
  const suggestion = cleaned && !(await isHandleTaken(cleaned)) ? cleaned : await suggestHandle();
  throw new HttpError(400, "invalid_handle", HANDLE_RULE, { suggestion });
}
