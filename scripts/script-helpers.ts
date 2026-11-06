/** Shared helpers for CLI scripts: direct fixtures (no HTTP sign-up limits) and an HTTP client. */
import "./load-env";
import crypto from "node:crypto";
import { db, schema } from "@/db";
import { createSession } from "@/lib/session";
import { storeNumber } from "@/lib/vault";
import { createToken } from "@/lib/tokens";
import { env } from "@/lib/env";

export const UA = "pryingeyes-script/1.0";
export const BASE = process.env.TARGET_URL ?? env().APP_URL;

export function arg(name: string, def: string) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
}

export function synthetic() {
  return `+268${["76", "78", "79"][crypto.randomInt(3)]}${crypto.randomInt(1e6).toString().padStart(6, "0")}`;
}

/** Creates an active caller with a verified phone and returns a session cookie for UA. */
export async function fixtureCaller(handle = `script_${crypto.randomBytes(4).toString("hex")}`) {
  const [u] = await db().insert(schema.users).values({ handle, status: "active", ageConfirmedAt: new Date(), phoneVerifiedAt: new Date() }).returning();
  await storeNumber(u.id, synthetic(), "account");
  const secret = await createSession(u.id, UA, { mfa: false, mfaPending: false });
  return { user: u, cookie: `${env().APP_URL.startsWith("https://") ? "__Host-pe_sid" : "pe_sid"}=${secret}` };
}

/** Creates an owner with a protected number and one token; returns the plaintext link. */
export async function fixtureOwnerToken(tier = 1) {
  const handle = `script_owner_${crypto.randomBytes(4).toString("hex")}`;
  const [u] = await db().insert(schema.users).values({ handle, status: "active", ageConfirmedAt: new Date(), email: `${handle}@example.test`, emailVerifiedAt: new Date() }).returning();
  const n = await storeNumber(u.id, synthetic(), "protected", "script");
  const t = await createToken(u.id, { numberId: n.id, tier, class: "standard", label: "Load test" });
  return { owner: u, link: t.codes.link, short: t.codes.short };
}

export async function post(path: string, body: unknown, cookie: string, ip?: string) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: new URL(env().APP_URL).origin, cookie, "user-agent": UA, ...(ip ? { "x-forwarded-for": ip } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, ms: performance.now() - t0 };
}

export function percentile(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
}
