import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { log } from "@/lib/log";
import { safeFetchHtml } from "@/lib/safe-fetch";

/** The kinds of public notice the bot collects. */
export const CONTENT_CATEGORIES = ["job", "scholarship", "scam_alert", "tender", "service_notice", "weather"] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export const CONTENT_CATEGORY_LABEL: Record<ContentCategory, string> = {
  job: "Jobs", scholarship: "Scholarships", scam_alert: "Scam alerts", tender: "Tenders",
  service_notice: "Service notices", weather: "Weather warnings",
};

type SourceInput = { name: string; url: string; country?: string; category: string; mode?: "rules" | "ai"; rules?: string | null; enabled?: boolean; intervalHours?: number };

function cleanUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw badRequest("bad_url", "That isn't a valid URL."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw badRequest("bad_url", "Only http(s) sources are allowed.");
  if (u.username || u.password) throw badRequest("bad_url", "No credentials in source URLs.");
  return u.toString();
}

function checkCategory(c: string): ContentCategory {
  if (!(CONTENT_CATEGORIES as readonly string[]).includes(c)) throw badRequest("bad_category", "Unknown category.");
  return c as ContentCategory;
}

// ── Sources ──────────────────────────────────────────────────────

export async function listSources() {
  return db().select().from(schema.contentSources).orderBy(asc(schema.contentSources.createdAt));
}

export async function addSource(i: SourceInput) {
  const url = cleanUrl(i.url);
  const category = checkCategory(i.category);
  const mode = i.mode === "ai" ? "ai" : "rules";
  const intervalHours = Math.max(1, Math.min(168, i.intervalHours ?? 6));
  const exists = await db().select({ id: schema.contentSources.id }).from(schema.contentSources).where(eq(schema.contentSources.url, url));
  if (exists.length) throw conflict("duplicate_source", "That source is already added.");
  const [s] = await db().insert(schema.contentSources).values({
    name: (i.name ?? "").trim().slice(0, 80) || url, url, category,
    country: (i.country ?? env().DEFAULT_COUNTRY).toUpperCase().slice(0, 2),
    mode, rules: i.rules ?? null, enabled: i.enabled ?? true, intervalHours,
  }).returning();
  return s;
}

export async function updateSource(id: string, i: Partial<SourceInput>) {
  const patch: Record<string, unknown> = {};
  if (i.name !== undefined) patch.name = (i.name ?? "").trim().slice(0, 80);
  if (i.url !== undefined) patch.url = cleanUrl(i.url);
  if (i.category !== undefined) patch.category = checkCategory(i.category);
  if (i.mode !== undefined) patch.mode = i.mode === "ai" ? "ai" : "rules";
  if (i.rules !== undefined) patch.rules = i.rules;
  if (i.enabled !== undefined) patch.enabled = !!i.enabled;
  if (i.intervalHours !== undefined) patch.intervalHours = Math.max(1, Math.min(168, i.intervalHours));
  if (i.country !== undefined) patch.country = i.country.toUpperCase().slice(0, 2);
  const [s] = await db().update(schema.contentSources).set(patch).where(eq(schema.contentSources.id, id)).returning();
  if (!s) throw notFound("not_found", "Source not found.");
  return s;
}

export async function removeSource(id: string) {
  await db().delete(schema.contentSources).where(eq(schema.contentSources.id, id));
  return { ok: true };
}

// ── Routes: which group each country+category posts into ─────────

export async function listRoutes() {
  const rows = await db().select().from(schema.contentRoutes).orderBy(asc(schema.contentRoutes.country), asc(schema.contentRoutes.category));
  const gids = [...new Set(rows.map((r) => r.groupId))];
  const groups = gids.length ? await db().select({ id: schema.groups.id, name: schema.groups.name }).from(schema.groups).where(sql`${schema.groups.id} IN ${gids}`) : [];
  const byId = new Map(groups.map((g) => [g.id, g.name]));
  return rows.map((r) => ({ ...r, groupName: byId.get(r.groupId) ?? r.groupId }));
}

export async function setRoute(country: string, category: string, groupId: string) {
  const c = country.toUpperCase().slice(0, 2);
  const cat = checkCategory(category);
  const [g] = await db().select({ id: schema.groups.id }).from(schema.groups).where(eq(schema.groups.id, groupId));
  if (!g) throw notFound("not_found", "Group not found.");
  const [r] = await db().insert(schema.contentRoutes).values({ country: c, category: cat, groupId })
    .onConflictDoUpdate({ target: [schema.contentRoutes.country, schema.contentRoutes.category], set: { groupId } }).returning();
  return r;
}

export async function removeRoute(id: string) {
  await db().delete(schema.contentRoutes).where(eq(schema.contentRoutes.id, id));
  return { ok: true };
}

// ── State ────────────────────────────────────────────────────────

export async function botState() {
  const [s] = await db().select().from(schema.contentState).where(eq(schema.contentState.id, 1));
  const [sourceCount] = await db().select({ c: sql<number>`count(*)::int` }).from(schema.contentSources);
  const [newCount] = await db().select({ c: sql<number>`count(*)::int` }).from(schema.contentItems).where(eq(schema.contentItems.status, "new"));
  return {
    paused: s?.paused ?? true, lastRunAt: s?.lastRunAt ?? null, day: s?.day ?? "", dailyCount: s?.dailyCount ?? 0,
    sources: sourceCount?.c ?? 0, queueNew: newCount?.c ?? 0, enabled: env().CONTENT_BOT === "on",
  };
}

export async function setPaused(paused: boolean) {
  await db().insert(schema.contentState).values({ id: 1, paused }).onConflictDoUpdate({ target: schema.contentState.id, set: { paused } });
  return botState();
}

// ── Queue ────────────────────────────────────────────────────────

export async function listItems(status?: string, limit = 100) {
  const cond = status && status !== "all" ? eq(schema.contentItems.status, status) : undefined;
  const rows = await db().select().from(schema.contentItems).where(cond)
    .orderBy(desc(schema.contentItems.createdAt)).limit(Math.min(500, limit));
  const sids = [...new Set(rows.map((r) => r.sourceId).filter((x): x is string => !!x))];
  const sources = sids.length ? await db().select({ id: schema.contentSources.id, name: schema.contentSources.name }).from(schema.contentSources).where(sql`${schema.contentSources.id} IN ${sids}`) : [];
  const byId = new Map(sources.map((s) => [s.id, s.name]));
  return rows.map((r) => ({ ...r, sourceName: r.sourceId ? (byId.get(r.sourceId) ?? null) : null }));
}

export async function setItemStatus(id: string, status: "discarded" | "new") {
  const [r] = await db().update(schema.contentItems).set({ status, processedAt: status === "discarded" ? new Date() : null })
    .where(eq(schema.contentItems.id, id)).returning();
  if (!r) throw notFound("not_found", "Item not found.");
  return r;
}

// ── Fetcher + rules-only extraction ──────────────────────────────

const ITEM_REGEX = /<item[^>]*>([\s\S]*?)<\/item>|<entry[^>]*>([\s\S]*?)<\/entry>/gi;
const DEADLINE_WORDS = /\b(?:deadline|closing date|apply by|closes?\s+on|due by|submissions?\s+(?:close|due)|expires?\s+on)\b[:\-]?/i;
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_RE = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
}

function textOf(html: string): string {
  return decode(html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function firstMatch(re: RegExp, hay: string): string {
  const m = re.exec(hay);
  return m ? (m[1] ?? "").trim() : "";
}

function utc(y: number, mo: number, d: number): Date | null {
  const dt = new Date(Date.UTC(y, mo, d, 23, 59, 59));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function findDeadline(text: string): Date | null {
  const lines = text.split(/\n|\.\s+/);
  for (const line of lines) {
    if (!DEADLINE_WORDS.test(line)) continue;
    let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(line);
    if (m) { const d = utc(+m[1], +m[2] - 1, +m[3]); if (d) return d; }
    m = new RegExp(`(\\d{1,2})\\s+(${MONTH_RE})[a-z]*\\s+(\\d{4})`, "i").exec(line);
    if (m) { const d = utc(+m[3], MONTHS[m[2].toLowerCase().slice(0, 3)], +m[1]); if (d) return d; }
    m = new RegExp(`(${MONTH_RE})[a-z]*\\s+(\\d{1,2}),?\\s+(\\d{4})`, "i").exec(line);
    if (m) { const d = utc(+m[3], MONTHS[m[1].toLowerCase().slice(0, 3)], +m[2]); if (d) return d; }
    m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(line);
    if (m) { const d = utc(+m[3], +m[2] - 1, +m[1]); if (d) return d; }
  }
  return null;
}

/** Pull the notice text out of a fetched page. Rules-only: no AI, just the page's own structure. */
export function extractItems(body: string, contentType: string, s: { id: string; category: ContentCategory; country: string; rules: string | null }): { url: string; title: string; body: string; deadline: Date | null }[] {
  const isFeed = /rss|atom|xml/i.test(contentType) || /<rss\b|<feed\b|<item\b|<entry\b/i.test(body.slice(0, 2000));
  if (isFeed) {
    const out: { url: string; title: string; body: string; deadline: Date | null }[] = [];
    let m: RegExpExecArray | null;
    ITEM_REGEX.lastIndex = 0;
    while ((m = ITEM_REGEX.exec(body)) !== null && out.length < 25) {
      const block = m[1] ?? m[2] ?? "";
      const link = firstMatch(/<(?:link|id)[^>]*>([\s\S]*?)<\/(?:link|id)>/i, block);
      const title = firstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, block);
      const desc = firstMatch(/<(?:description|summary|content:encoded)[^>]*>([\s\S]*?)<\/(?:description|summary|content:encoded)>/i, block);
      const t = textOf(title || desc);
      if (!t || !link) continue;
      const text = textOf(desc);
      out.push({ url: link, title: t.slice(0, 200), body: (text || t).slice(0, 4000), deadline: findDeadline(text) });
    }
    return out;
  }
  const rule: { itemRegex?: string } = (() => { try { return s.rules ? JSON.parse(s.rules) : {}; } catch { return {}; } })();
  if (rule.itemRegex) {
    const out: { url: string; title: string; body: string; deadline: Date | null }[] = [];
    let re: RegExp;
    try { re = new RegExp(rule.itemRegex, "gi"); } catch { return []; }
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null && out.length < 25) {
      const block = m[0];
      const link = firstMatch(/<a[^>]+href=["']([^"']+)["'][^>]*>/i, block);
      const title = firstMatch(/<(?:h[1-4]|title)[^>]*>([\s\S]*?)<\/(?:h[1-4]|title)>/i, block);
      const t = textOf(title);
      if (!t && !link) continue;
      const text = textOf(block);
      out.push({ url: link, title: (t || text).slice(0, 200), body: text.slice(0, 4000), deadline: findDeadline(text) });
    }
    return out;
  }
  const title = firstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, body) || firstMatch(/<h1[^>]*>([\s\S]*?)<\/h1>/i, body);
  const text = textOf(body);
  return [{ url: "", title: textOf(title).slice(0, 200) || text.slice(0, 80), body: text.slice(0, 8000), deadline: findDeadline(text) }];
}

// ── The run loop ─────────────────────────────────────────────────

async function sourceDue(s: typeof schema.contentSources.$inferSelect): Promise<boolean> {
  if (!s.enabled) return false;
  if (!s.lastFetchedAt) return true;
  return Date.now() - s.lastFetchedAt.getTime() >= s.intervalHours * 3600_000;
}

/** Fetch every due source, extract items with rules, and put new ones in the queue. */
export async function tickContentBot(): Promise<void> {
  if (env().CONTENT_BOT !== "on") return;
  const [state] = await db().select().from(schema.contentState).where(eq(schema.contentState.id, 1));
  if (state?.paused) return;
  const sources = await db().select().from(schema.contentSources);
  let fetched = 0, newItems = 0;
  for (const s of sources) {
    if (!(await sourceDue(s))) continue;
    try {
      const res = await safeFetchHtml(s.url, { timeoutMs: 15000, maxBytes: 1024 * 1024, accept: /text\/html|application\/xhtml|application\/xml|text\/xml|application\/(?:rss|atom)\+xml/i });
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
      const items = extractItems(res.body, res.contentType, { id: s.id, category: s.category as ContentCategory, country: s.country, rules: s.rules });
      for (const it of items) {
        const link = it.url || res.url;
        const existing = await db().select({ id: schema.contentItems.id }).from(schema.contentItems).where(eq(schema.contentItems.url, link));
        if (existing.length) continue;
        await db().insert(schema.contentItems).values({
          sourceId: s.id, url: link, title: it.title || "Untitled notice", body: it.body, category: s.category,
          country: s.country, deadline: it.deadline, status: "new",
        });
        newItems += 1;
      }
      await db().update(schema.contentSources).set({ lastFetchedAt: new Date() }).where(eq(schema.contentSources.id, s.id));
      fetched += 1;
    } catch (err) {
      log.warn({ err, source: s.id, url: s.url }, "content source fetch failed");
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const resetDay = state?.day !== today;
  await db().insert(schema.contentState).values({ id: 1, paused: state?.paused ?? true, lastRunAt: new Date(), day: today, dailyCount: newItems })
    .onConflictDoUpdate({ target: schema.contentState.id, set: { lastRunAt: new Date(), day: today, dailyCount: resetDay ? newItems : sql`${schema.contentState.dailyCount} + ${newItems}` } });
  if (fetched) console.log(`content bot: fetched ${fetched} sources, ${newItems} new items`);
}
