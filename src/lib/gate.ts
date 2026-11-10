/**
 * The decode gate (rules 6 and 7).
 *
 * Check order: lockout → IP budget → caller daily budget → CAPTCHA → token status →
 * caller standing → per-token budgets → OTP (Tier 2+) → owner consent (Tier 3).
 * The CAPTCHA runs before the token lookup so a CAPTCHA failure can never reveal whether a
 * code exists. Every negative outcome that touches a specific token returns the same
 * { status: "unavailable" } body; routes add a fixed response-time floor on top.
 */
import { and, desc, eq, gt, inArray, notInArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { verifyCaptcha } from "./captcha";
import { env } from "./env";
import { badRequest, conflict, notFound } from "./errors";
import { issueOtp, verifyOtp } from "./otp";
import { acquireInflight, gateBudgets, lockRemaining, recordCallerFailure, recordTokenFailure } from "./ratelimit";
import { countOutcome, findByCode, freezeToken, type Token } from "./tokens";
import { encryptForUser } from "./vault";
import { notify } from "./notify";
import { randomId } from "./crypto";
import type { AuthCtx } from "./auth";

export type GateOption = "reveal" | "chat" | "app_call";
export type GateView =
  | { status: "unavailable" }
  | { status: "limited"; retryAfter: number }
  | { status: "captcha_failed" }
  | {
      status: "ok"; requestId: string; tier: number; label: string;
      step: "otp" | "consent" | "waiting" | "choose";
      options: GateOption[]; otpSent: boolean; consentExpiresAt?: string | null;
    };

const UNAVAILABLE: GateView = { status: "unavailable" };
const GATE_SESSION_MS = 30 * 60_000;
const CONSENT_MS = 24 * 3600_000;
const OPEN_STAGES = ["started", "otp_sent", "verified", "consent_pending", "approved_relay", "approved_reveal"] as const;

type Req = typeof schema.decodeRequests.$inferSelect;

/**
 * What a caller who passed the gate may do. Calls are in-app only (over data). Seeing the number
 * needs a code backed by a phone number. ("approved_relay" is the historical name for "approved".)
 */
/** App-only codes have no number behind them: only a message or an in-app call. */
function optionsFor(r: Req, appOnly: boolean): GateOption[] {
  let base: GateOption[] = [];
  if (r.tier === 3) {
    if (r.stage === "approved_relay") base = ["chat", "app_call"];
    else if (r.stage === "approved_reveal") base = ["reveal", "chat", "app_call"];
  } else if (r.stage === "verified") base = ["reveal", "chat", "app_call"];
  return appOnly ? base.filter((o) => o !== "reveal") : base;
}

export function viewOf(r: Req, label: string, appOnly = false): GateView {
  if (r.stage === "declined" || r.stage === "expired" || r.expiresAt <= new Date()) return UNAVAILABLE;
  let step: "otp" | "consent" | "waiting" | "choose";
  if (r.stage === "started" || r.stage === "otp_sent") step = r.tier >= 2 ? "otp" : "choose";
  else if (r.stage === "verified") step = r.tier === 3 ? "consent" : "choose";
  else if (r.stage === "consent_pending") step = "waiting";
  else step = "choose";
  return {
    status: "ok", requestId: r.id, tier: r.tier, label, step, options: step === "choose" ? optionsFor(r, appOnly) : [],
    otpSent: r.stage === "otp_sent", consentExpiresAt: r.consentExpiresAt?.toISOString() ?? null,
  };
}

async function failCaller(callerId: string) {
  const locked = await recordCallerFailure(callerId);
  if (locked) {
    await notify(callerId, { kind: "lockout", title: "Too many failed attempts",
      body: `For safety, contacting people through PryingEyes is paused on your account for ${Math.round(locked / 60)} minutes.`, email: false });
  }
}

async function failToken(t: Token, reason: string) {
  if (await recordTokenFailure(t.id)) {
    const frozen = await freezeToken(t.id, reason);
    if (frozen) {
      await notify(t.ownerId, { kind: "token_frozen", title: `"${t.label}" was frozen`,
        body: "We froze this token after repeated failed attempts to get past the gate. Rotate it if you think it's being targeted, or resume it from your dashboard.",
        link: "/dashboard" });
    }
  }
}

async function rejected(t: Token | null, callerId: string, reason: string) {
  await audit({ type: "gate.rejected", actorId: callerId, ownerId: t?.ownerId ?? null, subjectType: t ? "token" : null,
    subjectId: t?.id ?? null, payload: { reason } });
}

export async function startGate(ctx: AuthCtx, input: { code: string; captcha?: string | null }, ip: string, edgeCountry: string | null): Promise<GateView> {
  const release = await acquireInflight(ctx.user.id);
  if (!release) return { status: "limited", retryAfter: 1 };
  try { return await startGateInner(ctx, input, ip, edgeCountry); } finally { await release(); }
}

async function startGateInner(ctx: AuthCtx, input: { code: string; captcha?: string | null }, ip: string, edgeCountry: string | null): Promise<GateView> {
  const callerId = ctx.user.id;
  const lock = await lockRemaining(callerId);
  if (lock > 0) return { status: "limited", retryAfter: lock };
  const ipb = await gateBudgets.ip(ip);
  if (!ipb.allowed) return { status: "limited", retryAfter: ipb.retryAfter };

  // Resume an open request for this token without spending budget (reload, back button).
  const token = await findByCode(input.code);
  if (token && token.status === "active") {
    const [open] = await db().select().from(schema.decodeRequests)
      .where(and(eq(schema.decodeRequests.tokenId, token.id), eq(schema.decodeRequests.callerId, callerId),
        inArray(schema.decodeRequests.stage, [...OPEN_STAGES]), gt(schema.decodeRequests.expiresAt, new Date())))
      .orderBy(desc(schema.decodeRequests.createdAt)).limit(1);
    if (open) return viewOf(open, token.label, !token.numberId);
  }

  const cb = await gateBudgets.caller(callerId);
  if (!cb.allowed) return { status: "limited", retryAfter: cb.retryAfter };

  if (!(await verifyCaptcha(input.captcha, ip))) {
    await failCaller(callerId);
    await rejected(null, callerId, "captcha");
    return { status: "captcha_failed" };
  }

  if (!token || token.status !== "active") {
    await failCaller(callerId);
    if (token) await failToken(token, "inactive_token");
    await rejected(token, callerId, token ? `status_${token.status}` : "unknown_code");
    return UNAVAILABLE;
  }

  // Caller standing: blocked by this owner → indistinguishable from an unknown code.
  const [blocked] = await db().select().from(schema.blocks)
    .where(and(eq(schema.blocks.blockerId, token.ownerId), eq(schema.blocks.blockedId, callerId)));
  if (blocked) {
    await failCaller(callerId);
    await rejected(token, callerId, "blocked");
    return UNAVAILABLE;
  }

  const [ct, tb] = await Promise.all([gateBudgets.callerToken(callerId, token.id), gateBudgets.token(token.id)]);
  if (!ct.allowed || !tb.allowed) {
    await rejected(token, callerId, !ct.allowed ? "caller_token_budget" : "token_budget");
    return UNAVAILABLE;
  }

  const region = edgeCountry ?? null;
  const [r] = await db().insert(schema.decodeRequests).values({
    tokenId: token.id, ownerId: token.ownerId, callerId, tier: token.tier,
    stage: token.tier === 1 ? "verified" : "started", verification: "account+captcha", region,
    expiresAt: new Date(Date.now() + GATE_SESSION_MS),
  }).returning();
  await audit({ type: "gate.passed", actorId: callerId, ownerId: token.ownerId, subjectType: "request", subjectId: r.id,
    payload: { tokenId: token.id, tier: token.tier, region } });
  return viewOf(r, token.label, !token.numberId);
}

/** Loads a request for its caller, with its token; null if not theirs or gone. */
async function callerRequest(callerId: string, requestId: string) {
  if (!/^[0-9a-f-]{36}$/.test(requestId)) return null;
  const rows = await db().select({ r: schema.decodeRequests, t: schema.tokens }).from(schema.decodeRequests)
    .innerJoin(schema.tokens, eq(schema.tokens.id, schema.decodeRequests.tokenId))
    .where(and(eq(schema.decodeRequests.id, requestId), eq(schema.decodeRequests.callerId, callerId)));
  return rows[0] ?? null;
}

export async function gateStatus(ctx: AuthCtx, requestId: string): Promise<GateView> {
  const row = await callerRequest(ctx.user.id, requestId);
  if (!row || row.t.status !== "active" && row.t.status !== "consumed") return UNAVAILABLE;
  return viewOf(row.r, row.t.label, !row.t.numberId);
}

export async function sendGateOtp(ctx: AuthCtx, requestId: string) {
  const row = await callerRequest(ctx.user.id, requestId);
  if (!row || row.t.status !== "active" || row.r.expiresAt <= new Date()) return UNAVAILABLE;
  if (row.r.tier < 2 || !["started", "otp_sent"].includes(row.r.stage)) throw conflict("invalid_step", "No code is needed at this step.");
  // Tier 2 and 3: the caller confirms a code sent to their verified email.
  const msg = (c: string) => `${c} is your PryingEyes code to reach "${row.t.label}". It expires in 10 minutes. Never share it.`;
  if (!ctx.user.email || !ctx.user.emailVerifiedAt) throw badRequest("no_contact", "Confirm your email address first.");
  await issueOtp({ userId: ctx.user.id, purpose: "gate", subject: requestId, message: msg, dest: { channel: "email", email: ctx.user.email } });
  await db().update(schema.decodeRequests).set({ stage: "otp_sent" }).where(eq(schema.decodeRequests.id, requestId));
  await audit({ type: "gate.otp_sent", actorId: ctx.user.id, ownerId: row.t.ownerId, subjectType: "request", subjectId: requestId });
  return viewOf({ ...row.r, stage: "otp_sent" }, row.t.label, !row.t.numberId);
}

export async function verifyGateOtp(ctx: AuthCtx, requestId: string, code: string): Promise<GateView | { status: "otp_wrong" }> {
  const row = await callerRequest(ctx.user.id, requestId);
  if (!row || row.t.status !== "active" || row.r.expiresAt <= new Date()) return UNAVAILABLE;
  if (row.r.stage !== "otp_sent") throw conflict("invalid_step", "Request a code first.");
  const lock = await lockRemaining(ctx.user.id);
  if (lock > 0) return { status: "limited", retryAfter: lock };
  const res = await verifyOtp("gate", requestId, code);
  if (res !== "ok") {
    await failCaller(ctx.user.id);
    await failToken(row.t, "otp");
    await audit({ type: "gate.otp_failed", actorId: ctx.user.id, ownerId: row.t.ownerId, subjectType: "request", subjectId: requestId });
    return { status: "otp_wrong" };
  }
  const [r] = await db().update(schema.decodeRequests).set({ stage: "verified", verification: "account+captcha+otp" })
    .where(eq(schema.decodeRequests.id, requestId)).returning();
  await audit({ type: "gate.otp_passed", actorId: ctx.user.id, ownerId: row.t.ownerId, subjectType: "request", subjectId: requestId });
  return viewOf(r, row.t.label, !row.t.numberId);
}

export async function requestConsent(ctx: AuthCtx, requestId: string, note: string | undefined) {
  const row = await callerRequest(ctx.user.id, requestId);
  if (!row || row.t.status !== "active" || row.r.expiresAt <= new Date()) return UNAVAILABLE;
  if (row.r.tier !== 3 || row.r.stage !== "verified") throw conflict("invalid_step", "This request can't be sent yet.");
  const clean = (note ?? "").trim().slice(0, 280);
  const consentExpiresAt = new Date(Date.now() + CONSENT_MS);
  const noteEnc = clean ? await encryptForUser(row.t.ownerId, clean, `note:${requestId}`) : null;
  const [r] = await db().update(schema.decodeRequests).set({
    stage: "consent_pending", noteEnc, consentExpiresAt, expiresAt: new Date(consentExpiresAt.getTime() + CONSENT_MS),
  }).where(eq(schema.decodeRequests.id, requestId)).returning();
  await audit({ type: "consent.requested", actorId: ctx.user.id, ownerId: row.t.ownerId, subjectType: "request", subjectId: requestId,
    payload: { hasNote: !!clean } });
  await notify(row.t.ownerId, { kind: "consent_request", title: `@${ctx.user.handle} wants to reach you`,
    body: `About "${row.t.label}". Approve, decline or block from your dashboard. The request expires in 24 hours.`, link: "/dashboard/requests" });
  return viewOf(r, row.t.label, !row.t.numberId);
}

export type Decision = "approve_relay" | "reveal_once" | "decline" | "decline_block";

export async function decide(owner: AuthCtx, requestId: string, decision: Decision) {
  if (!/^[0-9a-f-]{36}$/.test(requestId)) throw notFound();
  if (decision === "reveal_once") {
    // An app-only code has no number to show: approving it means chat and in-app calls.
    const [t] = await db().select({ numberId: schema.tokens.numberId }).from(schema.tokens).innerJoin(schema.decodeRequests, eq(schema.decodeRequests.tokenId, schema.tokens.id))
      .where(eq(schema.decodeRequests.id, requestId));
    if (t && !t.numberId) decision = "approve_relay";
  }
  const [r] = await db().select().from(schema.decodeRequests)
    .where(and(eq(schema.decodeRequests.id, requestId), eq(schema.decodeRequests.ownerId, owner.user.id)));
  if (!r) throw notFound("request_not_found", "Request not found.");
  if (r.stage !== "consent_pending") throw conflict("already_decided", "This request was already handled.");
  if (r.consentExpiresAt && r.consentExpiresAt <= new Date()) {
    await expireRequest(r);
    throw conflict("expired", "This request has expired.");
  }
  const stage = decision === "approve_relay" ? "approved_relay" : decision === "reveal_once" ? "approved_reveal" : "declined";
  await db().transaction(async (tx) => {
    await tx.update(schema.decodeRequests).set({ stage, decidedAt: new Date(),
      expiresAt: stage.startsWith("approved") ? new Date(Date.now() + CONSENT_MS) : r.expiresAt })
      .where(and(eq(schema.decodeRequests.id, requestId), eq(schema.decodeRequests.stage, "consent_pending")));
    if (decision === "decline_block") {
      await tx.insert(schema.blocks).values({ blockerId: owner.user.id, blockedId: r.callerId }).onConflictDoNothing();
    }
    const type = ({ approve_relay: "consent.approved_relay", reveal_once: "consent.approved_reveal", decline: "consent.declined", decline_block: "consent.declined_blocked" } as const)[decision];
    await audit({ type, actorId: owner.user.id, ownerId: owner.user.id, subjectType: "request", subjectId: requestId }, tx);
  });
  if (stage.startsWith("approved")) {
    // Also emailed, so the caller doesn't have to keep the gate page open while they wait.
    await notify(r.callerId, { kind: "info", title: "Your request was accepted", body: "Open PryingEyes to continue.", link: `/r/${requestId}` });
  }
  return { stage };
}

async function expireRequest(r: Req) {
  const u = await db().update(schema.decodeRequests).set({ stage: "expired" })
    .where(and(eq(schema.decodeRequests.id, r.id), eq(schema.decodeRequests.stage, "consent_pending"))).returning();
  if (u[0]) await audit({ type: "consent.expired", ownerId: r.ownerId, subjectType: "request", subjectId: r.id });
}

/** Retention job: unanswered consent requests expire after 24 h and count as declined. */
export async function expireStaleConsent() {
  const stale = await db().select().from(schema.decodeRequests)
    .where(and(eq(schema.decodeRequests.stage, "consent_pending"), gt(schema.decodeRequests.consentExpiresAt, new Date(0))));
  let n = 0;
  for (const r of stale) if (r.consentExpiresAt && r.consentExpiresAt <= new Date()) { await expireRequest(r); n++; }
  return n;
}

/**
 * Delivers an outcome. Returns what the caller needs next (a reveal URL, an in-app call id,
 * or a conversation id). The token is re-checked here, so revocation applies immediately.
 */
export async function chooseOutcome(ctx: AuthCtx, requestId: string, choice: GateOption) {
  const row = await callerRequest(ctx.user.id, requestId);
  const allowedStatus = row && (row.t.status === "active" || (row.t.status === "consumed" && row.r.outcomeCounted));
  if (!row || !allowedStatus || row.r.expiresAt <= new Date()) return { view: UNAVAILABLE };
  const view = viewOf(row.r, row.t.label, !row.t.numberId);
  if (view.status !== "ok" || view.step !== "choose" || !view.options.includes(choice)) throw conflict("invalid_step", "That option isn't available.");
  if (choice === "reveal" && row.r.outcome?.split(",").includes("reveal")) throw conflict("already_revealed", "You've already viewed this number once.");

  if (!row.r.outcomeCounted) {
    if (row.r.tier === 2) {
      const cap = await gateBudgets.tier2Daily(ctx.user.id);
      if (!cap.allowed) return { view: { status: "limited", retryAfter: cap.retryAfter } as GateView };
    }
    const claimed = await db().update(schema.decodeRequests).set({ outcomeCounted: true })
      .where(and(eq(schema.decodeRequests.id, requestId), eq(schema.decodeRequests.outcomeCounted, false))).returning();
    if (claimed[0]) await countOutcome(row.t.id);
  }

  const outcomes = new Set((row.r.outcome ?? "").split(",").filter(Boolean));
  outcomes.add(choice);
  // "Reveal once": after the reveal, the request continues as an approved chat/call request.
  const nextStage = row.r.stage === "approved_reveal" && choice === "reveal" ? "approved_relay" : row.r.stage;
  await db().update(schema.decodeRequests).set({ outcome: [...outcomes].join(","), stage: nextStage })
    .where(eq(schema.decodeRequests.id, requestId));

  if (choice === "reveal") {
    const grantId = randomId(24);
    await db().insert(schema.revealGrants).values({ id: grantId, requestId, callerId: ctx.user.id, expiresAt: new Date(Date.now() + 60_000) });
    await audit({ type: "reveal.granted", actorId: ctx.user.id, ownerId: row.t.ownerId, subjectType: "request", subjectId: requestId });
    return { view, revealUrl: `/api/reveal/${grantId}` };
  }
  if (choice === "app_call") {
    const { startAppCall } = await import("./calls");
    const call = await startAppCall({ requestId, token: row.t, caller: ctx.user });
    return { view, appCallId: call.id };
  }
  const { openConversation } = await import("./chat");
  const conv = await openConversation({ token: row.t, callerId: ctx.user.id });
  return { view, conversationId: conv.id };
}

export { notInArray };
