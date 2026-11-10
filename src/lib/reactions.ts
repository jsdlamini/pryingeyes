import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { badRequest, notFound, tooMany } from "./errors";
import { hit } from "./ratelimit";

export const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

export type ReactionView = { emoji: string; count: number; mine: boolean };

/** Throws "not found" unless this user can see the post, comment or chat message. */
async function assertCanSee(userId: string, kind: string, targetId: string) {
  const { visiblePost } = await import("./social");
  if (kind === "post") { await visiblePost(userId, targetId); return; }
  if (kind === "comment") {
    const [c] = await db().select({ postId: schema.comments.postId }).from(schema.comments).where(eq(schema.comments.id, targetId));
    if (!c) throw notFound();
    await visiblePost(userId, c.postId);
    return;
  }
  if (kind === "message") {
    const [m] = await db().select({ conv: schema.messages.conversationId }).from(schema.messages).where(eq(schema.messages.id, targetId));
    if (!m) throw notFound();
    const { participantConv } = await import("./chat");
    await participantConv(userId, m.conv);
    return;
  }
  throw notFound();
}

/** Toggle a reaction (add if absent, remove if present) and return the target's reactions. */
export async function toggleReaction(userId: string, kind: string, targetId: string, emoji: string) {
  if (!(EMOJIS as readonly string[]).includes(emoji)) throw badRequest("bad_emoji", "That reaction isn't available.");
  await assertCanSee(userId, kind, targetId);
  const b = await hit(`react:${userId}`, 120, 60);
  if (!b.allowed) throw tooMany(b.retryAfter, "Slow down a little.");
  const existing = await db().select().from(schema.reactions).where(and(
    eq(schema.reactions.userId, userId), eq(schema.reactions.kind, kind),
    eq(schema.reactions.targetId, targetId), eq(schema.reactions.emoji, emoji)));
  if (existing[0]) await db().delete(schema.reactions).where(eq(schema.reactions.id, existing[0].id));
  else await db().insert(schema.reactions).values({ userId, kind, targetId, emoji });
  const m = await reactionsFor(userId, kind, [targetId]);
  return m.get(targetId) ?? [];
}

/** Aggregate reactions for a set of targets, with a flag for the viewer's own reaction. */
export async function reactionsFor(viewerId: string, kind: string, targetIds: string[]): Promise<Map<string, ReactionView[]>> {
  const out = new Map<string, ReactionView[]>();
  if (!targetIds.length) return out;
  const rows = await db().select().from(schema.reactions).where(and(eq(schema.reactions.kind, kind), inArray(schema.reactions.targetId, targetIds)));
  const agg = new Map<string, Map<string, { count: number; mine: boolean }>>();
  for (const r of rows) {
    let per = agg.get(r.targetId);
    if (!per) { per = new Map(); agg.set(r.targetId, per); }
    const e = per.get(r.emoji) ?? { count: 0, mine: false };
    e.count++; if (r.userId === viewerId) e.mine = true;
    per.set(r.emoji, e);
  }
  for (const [id, per] of agg) out.set(id, [...per.entries()].map(([emoji, v]) => ({ emoji, ...v })));
  return out;
}
