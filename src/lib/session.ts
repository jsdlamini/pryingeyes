/**
 * Sessions: opaque random cookie; only its SHA-256 is stored. 12 h idle timeout, 30-day absolute
 * limit, bound to the device's user-agent, listed in a device manager with remote sign-out.
 */
import { and, eq, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { hmacHex, randomId, sha256Hex } from "./crypto";
import { secretsHmacKey } from "./keys";
import { env } from "./env";

export const IDLE_MS = 12 * 60 * 60 * 1000;
export const ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

export const cookieName = () => (env().APP_URL.startsWith("https://") ? "__Host-pe_sid" : "pe_sid");

export type Session = typeof schema.sessions.$inferSelect;
export type User = typeof schema.users.$inferSelect;

/** The PryingEyes phone app sends this header (and a bearer token instead of a cookie). */
export const isMobileClient = (req: Request) => req.headers.get("x-pe-client") === "mobile";

function deviceLabel(ua: string): string {
  const app = /PryingEyes-Mobile\/[\d.]+ \((Android|iOS|Web)/.exec(ua);
  if (app) return `PryingEyes app on ${app[1]}`;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  return `${browser} on ${os}`;
}
const uaHash = (ua: string) => hmacHex(secretsHmacKey(), `ua:${ua}`);

export async function createSession(userId: string, ua: string, opts: { mfa: boolean; mfaPending: boolean }) {
  const secret = randomId(32);
  const now = new Date();
  await db().insert(schema.sessions).values({
    id: sha256Hex(secret), userId, expiresAt: new Date(now.getTime() + ABSOLUTE_MS),
    mfaAt: opts.mfa ? now : null, mfaPending: opts.mfaPending, uaHash: uaHash(ua), deviceLabel: deviceLabel(ua),
  });
  return secret;
}

export function sessionCookie(secret: string, maxAgeSec = ABSOLUTE_MS / 1000) {
  const secure = env().APP_URL.startsWith("https://") ? "; Secure" : "";
  return `${cookieName()}=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}
export const clearSessionCookie = () => sessionCookie("", 0);

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

export async function loadSession(secret: string | null, ua: string): Promise<{ session: Session; user: User } | null> {
  if (!secret || secret.length > 128) return null;
  const id = sha256Hex(secret);
  const rows = await db().select({ s: schema.sessions, u: schema.users }).from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId)).where(eq(schema.sessions.id, id));
  const row = rows[0];
  if (!row) return null;
  const now = Date.now();
  const { s, u } = row;
  if (s.revokedAt || s.expiresAt.getTime() < now || s.lastSeenAt.getTime() + IDLE_MS < now) return null;
  if (s.uaHash !== uaHash(ua)) return null;
  if (u.status === "suspended") return null;
  if (now - s.lastSeenAt.getTime() > 60_000) {
    await db().update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, id));
  }
  return { session: s, user: u };
}

/** Device identity for session binding: the app's own label when it sends one, else the browser's user-agent. */
export const deviceUa = (req: Request) => req.headers.get("x-pe-device") ?? req.headers.get("user-agent") ?? "";

export async function sessionFromRequest(req: Request) {
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (bearer) return loadSession(bearer, deviceUa(req));
  return loadSession(readCookie(req.headers.get("cookie"), cookieName()), req.headers.get("user-agent") ?? "");
}

export async function markMfa(sessionId: string) {
  await db().update(schema.sessions).set({ mfaAt: new Date(), mfaPending: false }).where(eq(schema.sessions.id, sessionId));
}

export async function revokeSession(sessionId: string) {
  await db().update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, sessionId));
}

export async function revokeOtherSessions(userId: string, keepId?: string) {
  const cond = keepId
    ? and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt), ne(schema.sessions.id, keepId))
    : and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt));
  await db().update(schema.sessions).set({ revokedAt: new Date() }).where(cond);
}
