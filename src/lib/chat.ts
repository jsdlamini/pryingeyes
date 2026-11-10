/**
 * In-app chat (rule 10). TLS in transit; messages AES-256-GCM encrypted at rest under a
 * per-conversation key derived from the owner's data key. No server-side content scanning.
 * Disappearing messages (24 h) on Tier 3. Photos and voice notes are uploads the sender owns
 * (lib/uploads); a view-once photo's file is deleted when it is opened.
 */
import crypto from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { aesGcmDecrypt, aesGcmEncrypt } from "./crypto";
import { userDataKey } from "./vault";
import { badRequest, forbidden, notFound, tooMany } from "./errors";
import { hit } from "./ratelimit";
import type { Token } from "./tokens";
import { notify } from "./notify";
import { redis } from "./redis";
import { log } from "./log";
import { deleteUpload, ownUpload } from "./uploads";

const handleOf = async (id: string) =>
  (await db().select({ h: schema.users.handle }).from(schema.users).where(eq(schema.users.id, id)))[0]?.h ?? "someone";

/** Tells the other side about new chat activity. Never includes message text. */
async function notifyChat(c: Conv, senderId: string, kind: "new_chat" | "chat_message") {
  const recipient = c.ownerId === senderId ? c.callerId : c.ownerId;
  if (kind === "chat_message") {
    // At most one message alert per conversation per recipient every 15 minutes.
    const fresh = await redis().set(`notify:chat:${c.id}:${recipient}`, "1", "EX", 900, "NX");
    if (!fresh) return;
  }
  const who = await handleOf(senderId);
  const title = kind === "new_chat" ? `@${who} started a chat about "${c.label}"` : `New message from @${who}`;
  await notify(recipient, { kind, title, body: "Open PryingEyes to read and reply. No phone numbers are shared in chats.", link: `/chats/${c.id}` })
    .catch((err) => log.warn({ err }, "chat notification failed"));
}

export const DISAPPEAR_TIER3_SEC = 24 * 3600;
type Conv = typeof schema.conversations.$inferSelect;

async function convKey(c: Conv) {
  const dk = await userDataKey(c.ownerId);
  return crypto.createHmac("sha256", dk).update(`conv:${c.id}`).digest();
}

export async function openConversation(o: { token: Token; callerId: string; quiet?: boolean }) {
  const [existing] = await db().select().from(schema.conversations)
    .where(and(eq(schema.conversations.tokenId, o.token.id), eq(schema.conversations.callerId, o.callerId)));
  if (existing) return existing;
  const [c] = await db().insert(schema.conversations).values({
    tokenId: o.token.id, ownerId: o.token.ownerId, callerId: o.callerId, label: o.token.label,
    disappearSeconds: o.token.tier === 3 ? DISAPPEAR_TIER3_SEC : null,
  }).onConflictDoNothing().returning();
  const conv = c ?? (await db().select().from(schema.conversations)
    .where(and(eq(schema.conversations.tokenId, o.token.id), eq(schema.conversations.callerId, o.callerId))))[0];
  if (c) {
    await audit({ type: "chat.opened", actorId: o.callerId, ownerId: o.token.ownerId, subjectType: "conversation", subjectId: conv.id });
    if (!o.quiet) await notifyChat(conv, o.callerId, "new_chat");
  }
  return conv;
}

export async function participantConv(userId: string, convId: string) {
  if (!/^[0-9a-f-]{36}$/.test(convId)) throw notFound();
  const [c] = await db().select().from(schema.conversations).where(eq(schema.conversations.id, convId));
  if (!c || (c.ownerId !== userId && c.callerId !== userId)) throw notFound("conversation_not_found", "Conversation not found.");
  return c;
}

/** Both parties see the same safety number for a conversation — compare it to confirm no one is in the middle. */
export async function safetyNumber(userId: string, convId: string) {
  const c = await participantConv(userId, convId);
  const key = await convKey(c);
  const fp = crypto.createHmac("sha256", key).update(`safety:${c.id}`).digest();
  let digits = "";
  for (const b of fp) digits += String(b % 100).padStart(2, "0");
  return { safety: digits.slice(0, 60).replace(/(\d{5})(?=\d)/g, "$1 ").trim() };
}

async function isBlockedEitherWay(a: string, b: string) {
  const r = await db().select().from(schema.blocks).where(or(
    and(eq(schema.blocks.blockerId, a), eq(schema.blocks.blockedId, b)),
    and(eq(schema.blocks.blockerId, b), eq(schema.blocks.blockedId, a))));
  return r.length > 0;
}

/** The other person's handle, for someone taking part in this conversation. */
export async function chatPartnerHandle(userId: string, convId: string) {
  const c = await participantConv(userId, convId);
  const other = c.ownerId === userId ? c.callerId : c.ownerId;
  const [u] = await db().select({ h: schema.users.handle }).from(schema.users).where(eq(schema.users.id, other));
  return u?.h ?? "someone";
}

const CHAT_MEDIA = ["jpg", "png", "webp", "gif", "webm", "m4a", "mp3", "ogg"] as const;

export async function sendMessage(userId: string, convId: string, text: string, opts: { attachment?: string | null; attachmentKind?: string | null; viewOnce?: boolean } = {}) {
  const c = await participantConv(userId, convId);
  const clean = (text ?? "").replace(/\u0000/g, "").trim();
  const attachment = await ownUpload(userId, opts.attachment, CHAT_MEDIA);
  if (!clean && !attachment) throw badRequest("empty", "Write a message or attach something.");
  if (clean.length > 2000) throw badRequest("too_long", "Messages can be up to 2,000 characters.");
  if (c.closedAt) throw forbidden("closed", "This conversation is closed.");
  const other = c.ownerId === userId ? c.callerId : c.ownerId;
  if (await isBlockedEitherWay(userId, other)) throw forbidden("blocked", "You can't send messages in this conversation.");
  if (c.tokenId) {
    const [t] = await db().select({ status: schema.tokens.status }).from(schema.tokens).where(eq(schema.tokens.id, c.tokenId));
    if (userId === c.callerId && t && t.status === "revoked") throw forbidden("closed", "The owner has closed this contact.");
  }
  const b = await hit(`chat:send:${userId}`, 30, 60);
  if (!b.allowed) throw tooMany(b.retryAfter, "You're sending messages too quickly.");
  const id = crypto.randomUUID();
  const ciphertext = aesGcmEncrypt(await convKey(c), Buffer.from(clean, "utf8"), Buffer.from(`msg:${id}`));
  const now = new Date();
  await db().insert(schema.messages).values({
    id, conversationId: c.id, senderId: userId, ciphertext, attachment, attachmentKind: attachment ? (opts.attachmentKind ?? "image") : null, viewOnce: attachment ? !!opts.viewOnce : false, createdAt: now,
    expiresAt: c.disappearSeconds ? new Date(now.getTime() + c.disappearSeconds * 1000) : null,
  });
  await db().update(schema.conversations).set({ lastMessageAt: now }).where(eq(schema.conversations.id, c.id));
  await notifyChat(c, userId, "chat_message");
  return { id, createdAt: now };
}

/** The recipient opens a view-once attachment once; the server clears it after. */
export async function consumeMessage(userId: string, convId: string, messageId: string) {
  const c = await participantConv(userId, convId);
  const [m] = await db().select().from(schema.messages).where(and(eq(schema.messages.id, messageId), eq(schema.messages.conversationId, c.id)));
  if (!m) throw notFound("message_not_found", "Message not found.");
  if (m.senderId === userId) return { consumed: false };
  if (!m.viewOnce || !m.attachment) return { consumed: false };
  await db().update(schema.messages).set({ attachment: null, viewOnce: false }).where(eq(schema.messages.id, messageId));
  await deleteUpload(m.attachment); // the file goes too, not just the pointer to it
  return { consumed: true };
}

export async function listMessages(userId: string, convId: string, after?: Date) {
  const c = await participantConv(userId, convId);
  const now = new Date();
  const conds = [eq(schema.messages.conversationId, c.id), or(isNull(schema.messages.expiresAt), gt(schema.messages.expiresAt, now))!];
  if (after) conds.push(gt(schema.messages.createdAt, after));
  const rows = await db().select().from(schema.messages).where(and(...conds)).orderBy(asc(schema.messages.createdAt)).limit(200);
  const key = await convKey(c);
  // Read receipts: mark the other side's messages read, unless this reader turned receipts off.
  const [me] = await db().select({ rr: schema.users.readReceipts }).from(schema.users).where(eq(schema.users.id, userId));
  if (me?.rr !== false) {
    await db().update(schema.messages).set({ readAt: now })
      .where(and(eq(schema.messages.conversationId, c.id), isNull(schema.messages.readAt), sql`${schema.messages.senderId} <> ${userId}`));
  }
  const other = c.ownerId === userId ? c.callerId : c.ownerId;
  const [o] = await db().select({ handle: schema.users.handle }).from(schema.users).where(eq(schema.users.id, other));
  const { reactionsFor } = await import("./reactions");
  const reactionMap = rows.length ? await reactionsFor(userId, "message", rows.map((m) => m.id)) : new Map();
  const { callEventsFor } = await import("./calls");
  // Photos uploaded since 0.12 have an upload record and were re-encoded without location data.
  const uploadIds = rows.map((m) => /^\/uploads\/([0-9a-f-]{36})\./.exec(m.attachment ?? "")?.[1]).filter((x): x is string => !!x);
  const clean = new Set(uploadIds.length ? (await db().select({ id: schema.uploads.id }).from(schema.uploads).where(inArray(schema.uploads.id, uploadIds))).map((u) => u.id) : []);
  return {
    calls: await callEventsFor(c),
    conversation: { id: c.id, label: c.label, role: c.ownerId === userId ? "owner" : "caller", with: o?.handle ?? "deleted user",
      disappearSeconds: c.disappearSeconds, blocked: await isBlockedEitherWay(userId, other) },
    messages: rows.map((m) => ({
      id: m.id, mine: m.senderId === userId, at: m.createdAt, expiresAt: m.expiresAt, read: !!m.readAt,
      text: aesGcmDecrypt(key, m.ciphertext, Buffer.from(`msg:${m.id}`)).toString("utf8"),
      attachment: m.attachment, attachmentKind: m.attachmentKind, viewOnce: m.viewOnce,
      metadataRemoved: !!m.attachment && clean.has(/^\/uploads\/([0-9a-f-]{36})\./.exec(m.attachment)?.[1] ?? ""),
      reactions: reactionMap.get(m.id) ?? [],
    })),
  };
}

export async function listConversations(userId: string) {
  const rows = await db().select().from(schema.conversations)
    .where(or(eq(schema.conversations.ownerId, userId), eq(schema.conversations.callerId, userId)))
    .orderBy(desc(sql`coalesce(${schema.conversations.lastMessageAt}, ${schema.conversations.createdAt})`)).limit(100);
  const out = [];
  for (const c of rows) {
    const other = c.ownerId === userId ? c.callerId : c.ownerId;
    const [o] = await db().select({ handle: schema.users.handle }).from(schema.users).where(eq(schema.users.id, other));
    const [unread] = await db().select({ n: sql<number>`count(*)::int` }).from(schema.messages)
      .where(and(eq(schema.messages.conversationId, c.id), isNull(schema.messages.readAt), sql`${schema.messages.senderId} <> ${userId}`,
        or(isNull(schema.messages.expiresAt), gt(schema.messages.expiresAt, new Date()))));
    out.push({ id: c.id, label: c.label, role: c.ownerId === userId ? "owner" : "caller", with: o?.handle ?? "deleted user",
      lastMessageAt: c.lastMessageAt, unread: unread.n, disappearSeconds: c.disappearSeconds });
  }
  return out;
}

export async function blockInConversation(userId: string, convId: string) {
  const c = await participantConv(userId, convId);
  const other = c.ownerId === userId ? c.callerId : c.ownerId;
  await db().insert(schema.blocks).values({ blockerId: userId, blockedId: other }).onConflictDoNothing();
  await audit({ type: "chat.blocked", actorId: userId, ownerId: c.ownerId, subjectType: "conversation", subjectId: c.id });
}

export async function unblockUser(userId: string, otherId: string) {
  await db().delete(schema.blocks).where(and(eq(schema.blocks.blockerId, userId), eq(schema.blocks.blockedId, otherId)));
}

/** Retention job: delete expired disappearing messages. */
export async function purgeExpiredMessages() {
  const r = await db().delete(schema.messages).where(lt(schema.messages.expiresAt, new Date())).returning({ attachment: schema.messages.attachment });
  for (const m of r) if (m.attachment) await deleteUpload(m.attachment);
  return r.length;
}

/** Decrypts specific messages the reporter chose to attach (used only to build a report). */
export async function messagesForReport(userId: string, convId: string, ids: string[]) {
  const c = await participantConv(userId, convId);
  if (!ids.length) return [];
  const key = await convKey(c);
  const rows = await db().select().from(schema.messages).where(eq(schema.messages.conversationId, c.id));
  return rows.filter((m) => ids.includes(m.id)).map((m) => ({
    from: m.senderId === userId ? "reporter" : "reported", at: m.createdAt.toISOString(),
    text: aesGcmDecrypt(key, m.ciphertext, Buffer.from(`msg:${m.id}`)).toString("utf8"),
  }));
}

/** Unread messages across all of a user's conversations (for the menu badge). */
export async function unreadTotal(userId: string): Promise<number> {
  const [r] = await db().select({ n: sql<number>`count(*)::int` }).from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(and(or(eq(schema.conversations.ownerId, userId), eq(schema.conversations.callerId, userId)),
      isNull(schema.messages.readAt), sql`${schema.messages.senderId} <> ${userId}`,
      or(isNull(schema.messages.expiresAt), gt(schema.messages.expiresAt, new Date()))));
  return r?.n ?? 0;
}

/**
 * For the caller in a conversation: an open gate request on the same token that allows an in-app
 * call (so the chat can offer "Call privately" without re-running the gate). Owners can't start
 * calls; only the person who made contact can.
 */
export async function callOptionFor(userId: string, convId: string) {
  const c = await participantConv(userId, convId);
  if (!c.tokenId) return { canStart: false as const, reason: "no_token" };
  const [t] = await db().select().from(schema.tokens).where(eq(schema.tokens.id, c.tokenId));
  if (!t) return { canStart: false as const, reason: "no_token" };
  // The caller may still use a live gate request; otherwise either side can call from an established chat.
  if (c.callerId === userId) {
    const rows = await db().select().from(schema.decodeRequests)
      .where(and(eq(schema.decodeRequests.tokenId, c.tokenId), eq(schema.decodeRequests.callerId, userId), gt(schema.decodeRequests.expiresAt, new Date())))
      .orderBy(desc(schema.decodeRequests.createdAt)).limit(5);
    const { viewOf } = await import("./gate");
    for (const r of rows) {
      const usable = t.status === "active" || (t.status === "consumed" && r.outcomeCounted);
      const v = viewOf(r, t.label, !t.numberId);
      if (usable && v.status === "ok" && v.step === "choose" && v.options.includes("app_call"))
        return { canStart: true as const, requestId: r.id, appCall: true };
    }
  }
  return { canStart: true as const, chatCall: true };
}
