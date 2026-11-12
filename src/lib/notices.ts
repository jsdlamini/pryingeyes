import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { botAccountId } from "@/lib/bot";
import { decryptForUser } from "@/lib/vault";
import { personCountries } from "@/lib/places";

/** The bot's recent, non-expired notice posts, for the dashboard's notice board. */
export async function listNotices(userId: string, limit = 15) {
  const botId = await botAccountId();
  const [me] = await db().select({ hc: schema.users.homeCountry, ec: schema.users.extraCountries }).from(schema.users).where(eq(schema.users.id, userId));
  const mine = new Set(personCountries({ home_country: me?.hc ?? null, extra_countries: me?.ec ?? [] }));
  const official = await db().select({ id: schema.groups.id, name: schema.groups.name }).from(schema.groups).where(eq(schema.groups.official, true));
  if (!official.length) return [];
  const gids = official.map((g) => g.id);
  const byName = new Map(official.map((g) => [g.id, g.name]));
  const rows = await db().select().from(schema.posts)
    .where(and(eq(schema.posts.authorId, botId), inArray(schema.posts.groupId, gids),
      or(isNull(schema.posts.expiresAt), sql`${schema.posts.expiresAt} > now()`)))
    .orderBy(desc(schema.posts.createdAt)).limit(limit * 3);
  const pids = rows.map((p) => p.id);
  const items = pids.length ? await db().select().from(schema.contentItems).where(inArray(schema.contentItems.postId, pids)) : [];
  const meta = new Map(items.filter((i) => i.postId).map((i) => [i.postId as string, i]));
  const out: Array<{ id: string; text: string; groupName: string; category: string; country: string; region: string | null; deadline: Date | null; source: string; createdAt: Date }> = [];
  for (const p of rows) {
    let full = "";
    try { full = await decryptForUser(botId, p.bodyEnc, `post:${p.id}`); } catch { continue; }
    const text = full.split(/\n\s*\n/)[0]?.trim() || full;
    const m = meta.get(p.id);
    out.push({
      id: p.id, text, groupName: byName.get(p.groupId ?? "") ?? "",
      category: m?.category ?? "service_notice", country: m?.country ?? "SZ",
      region: m?.region ?? null, deadline: m?.deadline ?? p.expiresAt ?? null,
      source: m?.url ?? "", createdAt: p.createdAt,
    });
  }
  // The user's own countries first, then newest.
  out.sort((a, b) => {
    const am = mine.has(a.country) ? 0 : 1;
    const bm = mine.has(b.country) ? 0 : 1;
    if (am !== bm) return am - bm;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return out.slice(0, limit);
}
