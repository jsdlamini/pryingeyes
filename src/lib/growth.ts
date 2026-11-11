import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";

/** True when the user already has at least one code of their own. */
export async function hasCode(userId: string): Promise<boolean> {
  const [t] = await db().select({ id: schema.tokens.id }).from(schema.tokens).where(eq(schema.tokens.ownerId, userId)).limit(1);
  return !!t;
}

/** After a first successful contact, offer the growth loop once — never to code owners. One cheap query. */
export async function maybeTriggerGrowthLoop(userId: string): Promise<void> {
  try {
    const [row] = await db().select({
      lp: schema.users.loopPrompt,
      has: sql<boolean>`exists (select 1 from ${schema.tokens} where ${schema.tokens.ownerId} = ${userId})`,
    }).from(schema.users).where(eq(schema.users.id, userId));
    if (!row || row.lp || row.has) return;   // already shown/dismissed, or already owns a code
    await db().update(schema.users).set({ loopPrompt: "shown" }).where(eq(schema.users.id, userId));
    await audit({ type: "growth.loop_prompt_shown", actorId: userId, ownerId: userId });
  } catch { /* best-effort: never break a message or call */ }
}

export async function dismissGrowthLoop(userId: string): Promise<void> {
  await db().update(schema.users).set({ loopPrompt: "dismissed" }).where(eq(schema.users.id, userId));
  await audit({ type: "growth.loop_dismissed", actorId: userId, ownerId: userId });
}

export async function recordLoopCodeCreated(userId: string): Promise<void> {
  await db().update(schema.users).set({ loopPrompt: null }).where(eq(schema.users.id, userId));
  await audit({ type: "growth.loop_code_created", actorId: userId, ownerId: userId });
  // Attribute to the code that first brought them here (their earliest conversation as the caller).
  try {
    const [conv] = await db().select({ tokenId: schema.conversations.tokenId }).from(schema.conversations)
      .where(and(eq(schema.conversations.callerId, userId), isNotNull(schema.conversations.tokenId)))
      .orderBy(asc(schema.conversations.createdAt)).limit(1);
    if (conv?.tokenId) { const { bumpFunnel } = await import("./funnel"); void bumpFunnel(conv.tokenId, "loop_code_created"); }
  } catch { /* best-effort */ }
}
