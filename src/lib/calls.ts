/**
 * In-app calls over data (WebRTC). Phone numbers are never involved: each side is only a handle.
 *
 *  - Media flows browser-to-browser, forced through our own TURN relay (coturn) so neither side
 *    learns the other's IP address. TURN only forwards DTLS-SRTP packets it cannot decrypt, so a
 *    1:1 call is end-to-end encrypted between the two devices.
 *  - The server keeps call *metadata* only (who, when, how long, outcome) in `app_calls`.
 *  - Signalling (SDP offers/answers, ICE candidates) passes through Redis lists that expire after
 *    10 minutes and are deleted as soon as they are read. It is never written to Postgres or logs.
 *  - The API is plain HTTP so native apps can use the same state machine later; only the
 *    "incoming call" delivery changes (polling now, VoIP push on iOS/Android later).
 *
 * State machine:  ringing → accepted → ended
 *                 ringing → declined | missed | cancelled ;  (owner busy) → busy
 */
import crypto from "node:crypto";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { env } from "./env";
import { badRequest, conflict, notFound, tooMany } from "./errors";
import { hit } from "./ratelimit";
import { notify } from "./notify";
import { redis } from "./redis";
import { log } from "./log";
import type { Token } from "./tokens";
import type { User } from "./session";

export type AppCall = typeof schema.appCalls.$inferSelect;
export type CallStatus = "ringing" | "accepted" | "ended" | "declined" | "missed" | "cancelled" | "busy" | "failed";
const ACTIVE: CallStatus[] = ["ringing", "accepted"];
export const TERMINAL: CallStatus[] = ["ended", "declined", "missed", "cancelled", "busy", "failed"];
const MAX_CALL_SEC = 2 * 3600;
const HEARTBEAT_SEC = 30;     // a side that hasn't polled for this long is gone
const SIGNAL_TTL_SEC = 600;

const ringMs = () => env().CALL_RING_SECONDS * 1000;
const handleOf = async (id: string | null) => {
  if (!id) return "deleted user";
  const [u] = await db().select({ h: schema.users.handle }).from(schema.users).where(eq(schema.users.id, id));
  return u?.h ?? "deleted user";
};

// ---- TURN credentials (coturn "use-auth-secret" / TURN REST API) ----------------------------

/**
 * Short-lived TURN credentials. The username carries an expiry and a pseudonymous tag (never the
 * user id or handle), and the password is HMAC-SHA1(secret, username), which coturn checks itself.
 */
export function iceConfigFor(userId: string, ttlSec = 3600) {
  const e = env();
  const relayOnly = e.CALL_RELAY_ONLY === "true";
  const urls = e.TURN_URLS.split(",").map((u) => u.trim()).filter(Boolean);
  if (!e.TURN_SECRET || !urls.length) return { iceServers: [] as RTCIceServerLike[], relayOnly, ttlSec: 0, configured: false };
  const tag = crypto.createHmac("sha256", e.TURN_SECRET).update(`tag:${userId}`).digest("hex").slice(0, 12);
  const username = `${Math.floor(Date.now() / 1000) + ttlSec}:${tag}`;
  const credential = crypto.createHmac("sha1", e.TURN_SECRET).update(username).digest("base64");
  return { iceServers: [{ urls, username, credential }], relayOnly, ttlSec, configured: true };
}
type RTCIceServerLike = { urls: string[]; username: string; credential: string };

// ---- views -------------------------------------------------------------------------------

const hbKey = (id: string, uid: string) => `call:hb:${id}:${uid}`;
const sigKey = (id: string, uid: string) => `call:sig:${id}:${uid}`;
const presenceKey = (uid: string) => `call:presence:${uid}`;

export async function viewFor(userId: string, c: AppCall) {
  const role = c.callerId === userId ? "caller" : "owner";
  const other = role === "caller" ? c.ownerId : c.callerId;
  const otherAlive = other ? !!(await redis().exists(hbKey(c.id, other))) : false;
  const ringEndsAt = new Date(c.createdAt.getTime() + ringMs());
  const [conv] = c.tokenId && c.callerId ? await db().select({ id: schema.conversations.id }).from(schema.conversations)
    .where(and(eq(schema.conversations.tokenId, c.tokenId), eq(schema.conversations.callerId, c.callerId))) : [];
  return {
    conversationId: conv?.id ?? null, requestId: role === "caller" ? c.requestId : null,
    id: c.id, role, with: await handleOf(other), label: c.label, status: c.status as CallStatus, endedBy: c.endedBy,
    createdAt: c.createdAt, answeredAt: c.answeredAt, endedAt: c.endedAt, durationSec: c.durationSec,
    ringEndsAt, otherConnected: otherAlive,
    // For the caller while ringing: whether the owner has PryingEyes open right now.
    ownerOnline: role === "caller" && c.status === "ringing" && c.ownerId ? !!(await redis().exists(presenceKey(c.ownerId))) : undefined,
  };
}

async function participantCall(userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound("call_not_found", "Call not found.");
  const [c] = await db().select().from(schema.appCalls).where(eq(schema.appCalls.id, id));
  if (!c || (c.callerId !== userId && c.ownerId !== userId)) throw notFound("call_not_found", "Call not found.");
  return settle(c);
}

// ---- lifecycle ---------------------------------------------------------------------------

/** Shared call-starting logic: one active call per person, one line per callee. */
async function startCallBetween(o: { caller: User; ownerId: string; tokenId: string | null; requestId: string | null; label: string }) {
  const b = await hit(`call:start:${o.caller.id}`, 10, 3600);
  if (!b.allowed) throw tooMany(b.retryAfter, "You've started a lot of calls. Please wait a little.");
  await sweepCalls(true);
  const mine = await db().select({ id: schema.appCalls.id }).from(schema.appCalls)
    .where(and(inArray(schema.appCalls.status, ACTIVE), or(eq(schema.appCalls.callerId, o.caller.id), eq(schema.appCalls.ownerId, o.caller.id))));
  if (mine.length) throw conflict("already_in_call", "You're already in a call. End it first.");

  // One line per callee: a lock stops two simultaneous callers both getting through.
  const lock = await redis().set(`call:line:${o.ownerId}`, o.caller.id, "EX", 5, "NX");
  const [callee] = await db().select({ dnd: schema.users.doNotDisturb }).from(schema.users).where(eq(schema.users.id, o.ownerId));
  const ownerBusy = !lock || callee?.dnd === true || (await db().select({ id: schema.appCalls.id }).from(schema.appCalls)
    .where(and(eq(schema.appCalls.ownerId, o.ownerId), inArray(schema.appCalls.status, ACTIVE)))).length > 0;
  try {
    const now = new Date();
    const [call] = await db().insert(schema.appCalls).values({
      requestId: o.requestId, tokenId: o.tokenId, ownerId: o.ownerId, callerId: o.caller.id, label: o.label,
      status: ownerBusy ? "busy" : "ringing", ...(ownerBusy ? { endedAt: now, endedBy: "system" } : {}),
    }).returning();
    await audit({ type: ownerBusy ? "call.busy" : "call.started", actorId: o.caller.id, ownerId: o.ownerId, subjectType: "call", subjectId: call.id });
    if (ownerBusy) await missedNotice(call, "busy");
    else await notifyIncoming(call, o.caller.handle);
    return call;
  } finally {
    if (lock) await redis().del(`call:line:${o.ownerId}`);
  }
}

/** Starts a call from a gate request. */
export async function startAppCall(o: { requestId: string; token: Token; caller: User }) {
  return startCallBetween({ caller: o.caller, ownerId: o.token.ownerId, tokenId: o.token.id, requestId: o.requestId, label: o.token.label });
}

/** Call someone you already have a chat with — no fresh gate pass needed. */
export async function startChatCall(o: { caller: User; calleeId: string; label: string }) {
  return startCallBetween({ caller: o.caller, ownerId: o.calleeId, tokenId: null, requestId: null, label: o.label });
}

/**
 * Seam for delivering an incoming call. On the web, the owner's open app polls `incomingFor`.
 * Native apps will send a VoIP push here (APNs PushKit / FCM high priority) so the phone rings
 * even when the app is closed. Nothing is sent for the web, by design.
 */
async function notifyIncoming(_call: AppCall, _callerHandle: string) { /* native push goes here */ }

async function missedNotice(c: AppCall, why: "missed" | "busy" | "cancelled") {
  if (!c.ownerId || !c.callerId) return;
  const who = await handleOf(c.callerId);
  let link = "/chats";
  try {
    // Give the owner somewhere to answer: the chat with this caller (created quietly if needed).
    if (c.tokenId) {
      const [t] = await db().select().from(schema.tokens).where(eq(schema.tokens.id, c.tokenId));
      if (t && t.status !== "revoked") {
        const { openConversation } = await import("./chat");
        const conv = await openConversation({ token: t, callerId: c.callerId, quiet: true });
        link = `/chats/${conv.id}`;
      }
    }
  } catch (err) { log.warn({ err }, "missed-call conversation failed"); }
  await notify(c.ownerId, {
    kind: "missed_call",
    title: `Missed call from @${who} about "${c.label}"`,
    body: why === "busy" ? "You were on another call. You can reply in the chat." : "They called you in the app while it was closed. You can reply in the chat.",
    link,
  }).catch((err) => log.warn({ err }, "missed-call notification failed"));
}

/** Applies timeouts to one call (lazy expiry) and returns the up-to-date row. */
async function settle(c: AppCall): Promise<AppCall> {
  const now = Date.now();
  if (c.status === "ringing" && now - c.createdAt.getTime() > ringMs()) {
    const [u] = await db().update(schema.appCalls).set({ status: "missed", endedAt: new Date(), endedBy: "system" })
      .where(and(eq(schema.appCalls.id, c.id), eq(schema.appCalls.status, "ringing"))).returning();
    if (u) {
      await audit({ type: "call.missed", ownerId: u.ownerId, subjectType: "call", subjectId: u.id });
      await missedNotice(u, "missed");
      return u;
    }
    return (await db().select().from(schema.appCalls).where(eq(schema.appCalls.id, c.id)))[0] ?? c;
  }
  if (c.status === "accepted" && c.answeredAt) {
    const age = (now - c.answeredAt.getTime()) / 1000;
    const r = redis();
    // Both apps poll during a call; if either side has been silent for HEARTBEAT_SEC it has gone
    // (tab closed, phone lost signal), so the call is over for both.
    const callerAlive = !!c.callerId && !!(await r.exists(hbKey(c.id, c.callerId)));
    const ownerAlive = !!c.ownerId && !!(await r.exists(hbKey(c.id, c.ownerId)));
    if (age > MAX_CALL_SEC || (age > HEARTBEAT_SEC && !(callerAlive && ownerAlive))) return (await finish(c, "system")) ?? c;
  }
  return c;
}

async function finish(c: AppCall, by: "caller" | "owner" | "system") {
  const end = new Date();
  const dur = c.answeredAt ? Math.max(0, Math.min(MAX_CALL_SEC, Math.round((end.getTime() - c.answeredAt.getTime()) / 1000))) : 0;
  const [u] = await db().update(schema.appCalls).set({ status: "ended", endedAt: end, endedBy: by, durationSec: dur })
    .where(and(eq(schema.appCalls.id, c.id), eq(schema.appCalls.status, "accepted"))).returning();
  if (u) await audit({ type: "call.ended", ownerId: u.ownerId, subjectType: "call", subjectId: u.id, payload: { durationSec: dur, endedBy: by } });
  await cleanupSignals(c);
  return u;
}

async function cleanupSignals(c: AppCall) {
  const keys = [c.callerId, c.ownerId].filter(Boolean).flatMap((u) => [sigKey(c.id, u!), hbKey(c.id, u!)]);
  if (keys.length) await redis().del(...keys);
}

export type CallAction = "accept" | "decline" | "cancel" | "hangup";

export async function actOnCall(userId: string, id: string, action: CallAction) {
  const c = await participantCall(userId, id);
  const role = c.callerId === userId ? "caller" : "owner";
  if (TERMINAL.includes(c.status as CallStatus)) return viewFor(userId, c); // idempotent
  const set = async (from: CallStatus, patch: Partial<AppCall>) =>
    (await db().update(schema.appCalls).set(patch).where(and(eq(schema.appCalls.id, c.id), eq(schema.appCalls.status, from))).returning())[0];

  let u: AppCall | undefined;
  if (c.status === "ringing") {
    if (action === "accept") {
      if (role !== "owner") throw conflict("invalid_action", "Only the person being called can answer.");
      u = await set("ringing", { status: "accepted", answeredAt: new Date() });
      if (u) await audit({ type: "call.answered", actorId: userId, ownerId: u.ownerId, subjectType: "call", subjectId: u.id });
    } else if (role === "owner") {
      u = await set("ringing", { status: "declined", endedAt: new Date(), endedBy: "owner" });
      if (u) { await audit({ type: "call.declined", actorId: userId, ownerId: u.ownerId, subjectType: "call", subjectId: u.id }); await cleanupSignals(u); }
    } else {
      u = await set("ringing", { status: "cancelled", endedAt: new Date(), endedBy: "caller" });
      if (u) {
        await audit({ type: "call.missed", actorId: userId, ownerId: u.ownerId, subjectType: "call", subjectId: u.id, payload: { cancelled: true } });
        await cleanupSignals(u);
        // A ring the owner never saw is a missed call; one they were looking at isn't.
        if (u.ownerId && !(await redis().exists(presenceKey(u.ownerId)))) await missedNotice(u, "cancelled");
      }
    }
  } else if (c.status === "accepted") {
    if (action === "accept") return viewFor(userId, c);
    u = await finish(c, role);
  }
  const [fresh] = await db().select().from(schema.appCalls).where(eq(schema.appCalls.id, c.id));
  return viewFor(userId, fresh ?? u ?? c);
}

export async function getCall(userId: string, id: string) {
  return viewFor(userId, await participantCall(userId, id));
}

/** The owner's open app polls this. It also records that they're online (for the caller's UI). */
export async function incomingFor(userId: string) {
  await redis().set(presenceKey(userId), "1", "EX", 8);
  await sweepCalls();
  const [c] = await db().select().from(schema.appCalls)
    .where(and(eq(schema.appCalls.ownerId, userId), eq(schema.appCalls.status, "ringing"),
      sql`${schema.appCalls.createdAt} > ${new Date(Date.now() - ringMs())}`))
    .orderBy(desc(schema.appCalls.createdAt)).limit(1);
  if (!c) return null;
  return { id: c.id, from: await handleOf(c.callerId), label: c.label, createdAt: c.createdAt, ringEndsAt: new Date(c.createdAt.getTime() + ringMs()) };
}

/** Expires stale rings and dead calls. Cheap; at most once every 5 seconds across the cluster. */
export async function sweepCalls(force = false) {
  if (!force && !(await redis().set("call:sweep", "1", "EX", 5, "NX"))) return 0;
  const stale = await db().select().from(schema.appCalls).where(or(
    and(eq(schema.appCalls.status, "ringing"), lt(schema.appCalls.createdAt, new Date(Date.now() - ringMs()))),
    and(eq(schema.appCalls.status, "accepted"), lt(schema.appCalls.answeredAt, new Date(Date.now() - HEARTBEAT_SEC * 1000))),
  )).limit(200);
  let n = 0;
  for (const c of stale) { const u = await settle(c); if (u.status !== c.status) n++; }
  return n;
}

// ---- signalling --------------------------------------------------------------------------

export type Signal =
  | { type: "offer" | "answer"; sdp: string }
  | { type: "ice"; candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } }
  | { type: "restart" };

/** Drops anything that could reveal a device's own IP address when calls are relay-only. */
function scrub(s: Signal): Signal | null {
  if (env().CALL_RELAY_ONLY !== "true") return s;
  const relayOnly = (line: string) => !/\btyp (host|srflx|prflx)\b/.test(line);
  if (s.type === "ice") return relayOnly(s.candidate.candidate) ? s : null;
  if (s.type === "offer" || s.type === "answer") {
    return { ...s, sdp: s.sdp.split(/\r?\n/).filter((l) => !l.startsWith("a=candidate:") || relayOnly(l)).join("\r\n") };
  }
  return s;
}

export async function pushSignal(userId: string, id: string, s: Signal) {
  const c = await participantCall(userId, id);
  if (!ACTIVE.includes(c.status as CallStatus)) throw conflict("call_over", "This call has ended.");
  if ((s.type === "offer" || s.type === "answer") && c.status !== "accepted") throw conflict("not_answered", "The call hasn't been answered yet.");
  const b = await hit(`call:sig:${id}:${userId}`, 300, 60);
  if (!b.allowed) throw tooMany(b.retryAfter);
  const clean = scrub(s);
  if (!clean) return { dropped: true };
  const other = c.callerId === userId ? c.ownerId : c.callerId;
  if (!other) throw badRequest("no_peer", "The other person left.");
  const k = sigKey(id, other);
  await redis().multi().rpush(k, JSON.stringify(clean)).ltrim(k, -200, -1).expire(k, SIGNAL_TTL_SEC).exec();
  return { dropped: false };
}

/** Returns (and deletes) signals waiting for this user, plus the call state. Also a heartbeat. */
export async function pullSignals(userId: string, id: string) {
  const c = await participantCall(userId, id);
  const k = sigKey(id, userId);
  let signals: Signal[] = [];
  if (ACTIVE.includes(c.status as CallStatus)) {
    await redis().set(hbKey(id, userId), "1", "EX", HEARTBEAT_SEC);
    const res = await redis().multi().lrange(k, 0, -1).del(k).exec();
    const raw = (res?.[0]?.[1] as string[] | undefined) ?? [];
    signals = raw.map((r) => { try { return JSON.parse(r) as Signal; } catch { return null; } }).filter((x): x is Signal => !!x);
  }
  return { call: await viewFor(userId, c), signals };
}

/** Call events for a conversation's timeline (same token and caller). Metadata only. */
export async function callEventsFor(conv: { tokenId: string | null; callerId: string }) {
  if (!conv.tokenId) return [];
  const rows = await db().select().from(schema.appCalls)
    .where(and(eq(schema.appCalls.tokenId, conv.tokenId), eq(schema.appCalls.callerId, conv.callerId)))
    .orderBy(desc(schema.appCalls.createdAt)).limit(50);
  return rows.map((c) => ({ id: c.id, at: c.createdAt, status: c.status as CallStatus, durationSec: c.durationSec }));
}
