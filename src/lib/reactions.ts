import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

export const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

export type ReactionView = { emoji: string; count: number; mine: boolean };

/** Toggle a reaction (add if absent, remove if present) and return the target's reactions. */
export async function toggleReaction(userId: string, kind: string, targetId: string, emoji: string) {
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
