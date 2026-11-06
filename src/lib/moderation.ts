/**
 * Reports and the moderation queue (rule 14). Moderators see reports and metadata — and the
 * messages a reporter chose to attach — but never phone numbers.
 */
import crypto from "node:crypto";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { aesGcmDecrypt, aesGcmEncrypt } from "./crypto";
import { secretsHmacKey } from "./keys";
import { badRequest, conflict, notFound } from "./errors";
import { messagesForReport, participantConv } from "./chat";
import { notify } from "./notify";
import { hit } from "./ratelimit";
import { tooMany } from "./errors";
import { revokeOtherSessions } from "./session";

const modKey = () => crypto.createHmac("sha256", secretsHmacKey()).update("moderation-data-key-v1").digest();
export const REPORT_REASONS = ["harassment", "spam", "scam", "threats", "impersonation", "other"] as const;
export const SLA_MINUTES = 60;

export async function createReport(reporterId: string, input: {
  conversationId?: string; requestId?: string; reason: typeof REPORT_REASONS[number]; details?: string; messageIds?: string[];
  /** Resolved by the social layer after checking the reporter can see the post. */
  post?: { id: string; authorId: string; tokenId: string | null; text: string; at: Date; where: string };
}) {
  const b = await hit(`report:${reporterId}`, 20, 86400);
  if (!b.allowed) throw tooMany(b.retryAfter);
  let reportedUserId: string | null = null, conversationId: string | null = null, tokenId: string | null = null;
  let attached: unknown[] = [];
  let postId: string | null = null;
  if (input.post) {
    if (input.post.authorId === reporterId) throw badRequest("report_self", "You can't report your own post.");
    reportedUserId = input.post.authorId; tokenId = input.post.tokenId; postId = input.post.id;
    attached = [{ from: "reported", at: input.post.at.toISOString(), text: input.post.text, where: input.post.where }];
  } else if (input.conversationId) {
    const c = await participantConv(reporterId, input.conversationId);
    reportedUserId = c.ownerId === reporterId ? c.callerId : c.ownerId;
    conversationId = c.id; tokenId = c.tokenId;
    attached = await messagesForReport(reporterId, c.id, (input.messageIds ?? []).slice(0, 20));
  } else if (input.requestId) {
    const [r] = await db().select().from(schema.decodeRequests).where(eq(schema.decodeRequests.id, input.requestId));
    if (!r || (r.ownerId !== reporterId && r.callerId !== reporterId)) throw notFound();
    reportedUserId = r.ownerId === reporterId ? r.callerId : r.ownerId;
    tokenId = r.tokenId;
  } else {
    throw badRequest("report_target", "Report from a conversation or a request.");
  }
  const details = JSON.stringify({ text: (input.details ?? "").slice(0, 2000), messages: attached });
  const id = crypto.randomUUID();
  await db().insert(schema.reports).values({
    id, reporterId, reportedUserId, conversationId, tokenId, postId, reason: input.reason,
    detailsEnc: aesGcmEncrypt(modKey(), Buffer.from(details), Buffer.from(`report:${id}`)),
  });
  await audit({ type: postId ? "post.reported" : "chat.reported", actorId: reporterId, subjectType: "report", subjectId: id, payload: { reason: input.reason } });
  return { id };
}

export async function moderationQueue(status: "open" | "actioned" | "dismissed" = "open") {
  const rows = await db().select().from(schema.reports).where(eq(schema.reports.status, status))
    .orderBy(status === "open" ? asc(schema.reports.createdAt) : desc(schema.reports.createdAt)).limit(100);
  const handles = new Map<string, string>();
  const ids = [...new Set(rows.flatMap((r) => [r.reporterId, r.reportedUserId]).filter(Boolean) as string[])];
  if (ids.length) for (const u of await db().select({ id: schema.users.id, handle: schema.users.handle, status: schema.users.status }).from(schema.users).where(inArray(schema.users.id, ids))) handles.set(u.id, `${u.handle}${u.status === "suspended" ? " (suspended)" : ""}`);
  const out = [];
  for (const r of rows) {
    const [prior] = r.reportedUserId ? await db().select({ c: count() }).from(schema.reports).where(eq(schema.reports.reportedUserId, r.reportedUserId)) : [{ c: 0 }];
    const details = r.detailsEnc ? JSON.parse(aesGcmDecrypt(modKey(), r.detailsEnc, Buffer.from(`report:${r.id}`)).toString()) : null;
    const ageMin = Math.floor((Date.now() - r.createdAt.getTime()) / 60000);
    out.push({
      id: r.id, kind: r.postId ? "post" : r.conversationId ? "chat" : "request", reason: r.reason, status: r.status, createdAt: r.createdAt, firstResponseAt: r.firstResponseAt, resolution: r.resolution,
      reporter: r.reporterId ? handles.get(r.reporterId) ?? "deleted" : "deleted",
      reported: r.reportedUserId ? handles.get(r.reportedUserId) ?? "deleted" : "deleted",
      reportsAgainstReported: prior.c, details, ageMinutes: ageMin, slaBreached: !r.firstResponseAt && ageMin > SLA_MINUTES,
    });
  }
  return out;
}

export type ModAction = "dismiss" | "warn" | "suspend" | "close_conversation" | "remove_post";

export async function moderate(moderatorId: string, reportId: string, action: ModAction, note = "") {
  const [r] = await db().select().from(schema.reports).where(eq(schema.reports.id, reportId));
  if (!r) throw notFound();
  if (r.status !== "open") throw conflict("already_handled", "This report was already handled.");
  await db().transaction(async (tx) => {
    await tx.update(schema.reports).set({
      status: action === "dismiss" ? "dismissed" : "actioned", assignedTo: moderatorId,
      firstResponseAt: r.firstResponseAt ?? new Date(), resolution: `${action}${note ? `: ${note.slice(0, 500)}` : ""}`,
    }).where(eq(schema.reports.id, reportId));
    if (action === "suspend" && r.reportedUserId) {
      await tx.update(schema.users).set({ status: "suspended" }).where(eq(schema.users.id, r.reportedUserId));
      await tx.update(schema.tokens).set({ status: "paused" }).where(and(eq(schema.tokens.ownerId, r.reportedUserId), eq(schema.tokens.status, "active")));
    }
    if (action === "remove_post" && r.postId) {
      await tx.delete(schema.posts).where(eq(schema.posts.id, r.postId));
    }
    if (action === "close_conversation" && r.conversationId) {
      await tx.update(schema.conversations).set({ closedAt: new Date() }).where(eq(schema.conversations.id, r.conversationId));
    }
    await audit({ type: "moderation.action", actorId: moderatorId, subjectType: "report", subjectId: reportId, payload: { action } }, tx);
  });
  if (action === "suspend" && r.reportedUserId) await revokeOtherSessions(r.reportedUserId);
  if (action === "warn" && r.reportedUserId) {
    await notify(r.reportedUserId, { kind: "info", title: "A warning about your conduct", body: "We received a report about your messages. Repeated reports lead to suspension.", email: true });
  }
  if (r.reporterId) await notify(r.reporterId, { kind: "report_update", title: "We've reviewed your report", body: "Thank you. A moderator has acted on your report.", email: false });
}
