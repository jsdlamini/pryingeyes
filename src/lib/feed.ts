/** Owner audit feed and dashboard summary. Handles and labels are resolved at read time. */
import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { listTokens } from "./tokens";
import { env } from "./env";

const OWNER_TYPES = [
  "gate.passed", "gate.rejected", "gate.otp_failed", "gate.otp_passed", "consent.requested", "consent.approved_relay",
  "consent.approved_reveal", "consent.declined", "consent.declined_blocked", "consent.expired", "reveal.viewed",
  "relay.started", "relay.completed", "relay.failed", "relay.cap_reached", "chat.opened", "chat.blocked",
  "token.created", "token.paused", "token.resumed", "token.rotated", "token.revoked", "token.frozen", "token.expired",
  "token.consumed", "token.extended", "panic.revoke_all", "number.added", "number.removed", "account.login",
  "account.login_failed", "account.recovery_started", "account.recovery_completed", "account.password_changed", "evidence.exported",
] as const;

const DESCRIBE: Record<string, string> = {
  "gate.passed": "passed the gate", "gate.rejected": "was refused at the gate", "gate.otp_failed": "entered a wrong code",
  "gate.otp_passed": "confirmed their code", "consent.requested": "asked to reach you", "consent.approved_relay": "You approved a relay call",
  "consent.approved_reveal": "You approved one reveal", "consent.declined": "You declined a request", "consent.declined_blocked": "You declined and blocked",
  "consent.expired": "A request expired unanswered", "reveal.viewed": "viewed your number (watermarked)", "relay.started": "started a relay call",
  "relay.completed": "Relay call ended", "relay.failed": "Relay call didn't connect", "relay.cap_reached": "Relay minutes cap reached",
  "chat.opened": "opened a chat", "chat.blocked": "Chat blocked", "token.created": "Token created", "token.paused": "Token paused",
  "token.resumed": "Token resumed", "token.rotated": "Token rotated", "token.revoked": "Token revoked", "token.frozen": "Token frozen after failed attempts",
  "token.expired": "Token expired", "token.consumed": "Disposable token used up", "token.extended": "Token extended", "panic.revoke_all": "Panic: all tokens revoked",
  "number.added": "Number added", "number.removed": "Number removed", "account.login": "Signed in", "account.login_failed": "Failed sign-in attempt",
  "account.recovery_started": "Account recovery started", "account.recovery_completed": "Account recovery completed",
  "account.password_changed": "Password changed", "evidence.exported": "Evidence pack exported",
};

export type FeedEntry = Awaited<ReturnType<typeof ownerFeed>>[number];

export async function ownerFeed(ownerId: string, opts: { limit?: number; beforeSeq?: number; from?: Date; to?: Date } = {}) {
  const conds = [eq(schema.auditEvents.ownerId, ownerId), inArray(schema.auditEvents.type, [...OWNER_TYPES])];
  if (opts.beforeSeq) conds.push(lt(schema.auditEvents.seq, opts.beforeSeq));
  if (opts.from) conds.push(gte(schema.auditEvents.at, opts.from));
  if (opts.to) conds.push(lt(schema.auditEvents.at, opts.to));
  const rows = await db().select().from(schema.auditEvents).where(and(...conds)).orderBy(desc(schema.auditEvents.seq)).limit(Math.min(opts.limit ?? 50, 5000));
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((a): a is string => !!a && a !== ownerId))];
  const handles = new Map<string, string>();
  if (actorIds.length) for (const u of await db().select({ id: schema.users.id, h: schema.users.handle }).from(schema.users).where(inArray(schema.users.id, actorIds))) handles.set(u.id, u.h);
  // Resolve token labels via request/token subjects
  const tokenIds = new Set<string>(), requestIds = new Set<string>();
  for (const r of rows) {
    if (r.subjectType === "token" && r.subjectId) tokenIds.add(r.subjectId);
    if (r.subjectType === "request" && r.subjectId) requestIds.add(r.subjectId);
    const p = r.payload as Record<string, unknown> | null;
    if (p?.tokenId) tokenIds.add(String(p.tokenId));
  }
  const reqToken = new Map<string, string>();
  if (requestIds.size) for (const q of await db().select({ id: schema.decodeRequests.id, t: schema.decodeRequests.tokenId, region: schema.decodeRequests.region, v: schema.decodeRequests.verification }).from(schema.decodeRequests).where(inArray(schema.decodeRequests.id, [...requestIds]))) { reqToken.set(q.id, q.t); tokenIds.add(q.t); }
  const labels = new Map<string, string>();
  if (tokenIds.size) for (const t of await db().select({ id: schema.tokens.id, l: schema.tokens.label }).from(schema.tokens).where(inArray(schema.tokens.id, [...tokenIds]))) labels.set(t.id, t.l);
  return rows.map((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const tokenId = r.subjectType === "token" ? r.subjectId : r.subjectType === "request" ? reqToken.get(r.subjectId!) : (p.tokenId as string | undefined);
    const actor = r.actorId && r.actorId !== ownerId ? handles.get(r.actorId) ?? "deleted user" : null;
    return {
      seq: r.seq, at: r.at, type: r.type, actor, token: tokenId ? labels.get(tokenId) ?? null : null,
      text: DESCRIBE[r.type] ?? r.type, region: (p.region as string) ?? null, reason: (p.reason as string) ?? null,
      durationSec: (p.durationSec as number) ?? null,
      outcome: r.type.startsWith("gate.rejected") || r.type === "gate.otp_failed" || r.type === "token.frozen" ? "bad"
        : r.type === "consent.requested" ? "pending" : "good",
      hash: r.hash,
    };
  });
}

export async function dashboardSummary(ownerId: string) {
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const tokens = await listTokens(ownerId);
  const [contacts] = await db().select({ c: count() }).from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.ownerId, ownerId), eq(schema.auditEvents.type, "gate.passed"), gte(schema.auditEvents.at, weekAgo)));
  const [blocked] = await db().select({ c: count() }).from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.ownerId, ownerId), inArray(schema.auditEvents.type, ["gate.rejected", "gate.otp_failed"]), gte(schema.auditEvents.at, weekAgo)));
  const [pending] = await db().select({ c: count() }).from(schema.decodeRequests)
    .where(and(eq(schema.decodeRequests.ownerId, ownerId), eq(schema.decodeRequests.stage, "consent_pending"), gte(schema.decodeRequests.consentExpiresAt, new Date())));
  const [nums] = await db().select({ c: count() }).from(schema.phoneNumbers)
    .where(and(eq(schema.phoneNumbers.userId, ownerId), eq(schema.phoneNumbers.kind, "protected")));
  return {
    stats: {
      activeTokens: tokens.filter((t) => t.status === "active").length, contactsThisWeek: contacts.c,
      pendingApprovals: pending.c, attemptsBlocked: blocked.c, numbers: nums.c,
    },
    tokens, feed: await ownerFeed(ownerId, { limit: 12 }),
  };
}
export { sql };
