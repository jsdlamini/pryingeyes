/**
 * Safe social layer: groups, group posts and 24-hour status updates. Anyone can create a group and
 * anyone can ask to join one (from search, or with an invite link), but only the group's creator or
 * the admins they appoint can let people in.
 *
 * The rule that shapes everything here: contact details never travel as text. The guard rejects
 * phone numbers, email addresses and messaging links in names, descriptions and posts. To be
 * reachable, an author attaches a contact code. Each group (and the status feed) gets its own
 * code, minted from the author's protected number, so the owner can see where a contact came
 * from and switch off one group's code without touching the others.
 *
 * Post text and attached codes are encrypted under the author's data key.
 */
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { groupCode, hmacHex, isCrockford, normaliseCrockford, randomCrockford } from "./crypto";
import { tokenPepper } from "./keys";
import { decryptForUser, encryptForUser } from "./vault";
import { env } from "./env";
import { badRequest, conflict, forbidden, notFound, tooMany } from "./errors";
import { hit } from "./ratelimit";
import { assertNoContactInfo } from "./guard";
import { createToken, expireIfDue, LIVE_STATUSES } from "./tokens";
import { createReport, REPORT_REASONS } from "./moderation";
import { notify } from "./notify";
import { reactionsFor } from "./reactions";
import { log } from "./log";
import { deleteUpload, ownUpload } from "./uploads";

export const INVITE_CHARS = 12;               // 60 bits
export const MAX_GROUP_MEMBERS = 1000;
export const STATUS_HOURS = 24;
const POST_MAX = 1000;

type Group = typeof schema.groups.$inferSelect;
type Post = typeof schema.posts.$inferSelect;
/**
 * A contact code attached to a post, status or chat message. No numberId: app-only (message and
 * in-app call). `kind`: "standard" lasts until switched off (and is reused in the same place),
 * "day" works for 24 hours, "one" works for one person only.
 */
export type CodeKind = "standard" | "day" | "one";
export type Attach = { numberId?: string | null; tier: 1 | 2 | 3; kind?: CodeKind };
/** state: live, used (a one-person code someone already used), expired, or off (paused or revoked). */
export type CodeView = { short: string; link: string; tier: number; live: boolean; state: "live" | "used" | "expired" | "off"; kind: CodeKind };

// ---- invites ---------------------------------------------------------------

const inviteHash = (code: string) => hmacHex(tokenPepper(), `invite:${code}`);
export const inviteLink = (code: string) => `${env().APP_URL}/g/${groupCode(code)}`;

export function parseInvite(input: string): string | null {
  const raw = (input ?? "").trim();
  const part = raw.match(/\/g\/([^/?#\s]+)/)?.[1] ?? raw;
  const s = normaliseCrockford(decodeURIComponent(part));
  return isCrockford(s) && s.length === INVITE_CHARS ? s : null;
}

async function newInvite(adminId: string, groupId: string) {
  const code = randomCrockford(INVITE_CHARS);
  return { code, inviteHash: inviteHash(code), inviteEnc: await encryptForUser(adminId, code, `invite:${groupId}`), inviteBy: adminId };
}

async function readInvite(g: Group): Promise<string | null> {
  if (!g.inviteEnc || !g.inviteBy) return null;
  try { return inviteLink(await decryptForUser(g.inviteBy, g.inviteEnc, `invite:${g.id}`)); } catch { return null; }
}

// ---- helpers ---------------------------------------------------------------

function cleanName(name: string) {
  const n = (name ?? "").trim().replace(/\s+/g, " ");
  if (n.length < 2 || n.length > 60) throw badRequest("invalid_name", "Give the group a name of 2 to 60 characters.");
  assertNoContactInfo(n, "name");
  return n;
}
function cleanAbout(about: string) {
  const a = (about ?? "").trim();
  if (a.length > 300) throw badRequest("invalid_about", "Keep the description under 300 characters.");
  assertNoContactInfo(a, "description");
  return a;
}

async function roleIn(userId: string, groupId: string): Promise<"admin" | "member" | null> {
  const [m] = await db().select({ role: schema.groupMembers.role }).from(schema.groupMembers)
    .where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, userId)));
  return (m?.role as "admin" | "member") ?? null;
}

async function memberGroup(userId: string, groupId: string) {
  const role = await roleIn(userId, groupId);
  if (!role) throw notFound("group_not_found", "This group doesn't exist or you're not a member.");
  const [g] = await db().select().from(schema.groups).where(eq(schema.groups.id, groupId));
  if (!g) throw notFound("group_not_found", "This group doesn't exist or you're not a member.");
  return { g, role };
}

async function handles(ids: string[]) {
  const m = new Map<string, string>();
  const uniq = [...new Set(ids)];
  if (uniq.length) for (const u of await db().select({ id: schema.users.id, h: schema.users.handle }).from(schema.users).where(inArray(schema.users.id, uniq))) m.set(u.id, u.h);
  return m;
}

async function avatars(ids: string[]): Promise<Map<string, string | null>> {
  const m = new Map<string, string | null>();
  const uniq = [...new Set(ids)];
  if (uniq.length) for (const u of await db().select({ id: schema.users.id, a: schema.users.avatarUrl }).from(schema.users).where(inArray(schema.users.id, uniq))) m.set(u.id, u.a);
  return m;
}

/** Everyone this user has blocked or been blocked by. Their posts are hidden both ways. */
async function blockedWith(userId: string): Promise<Set<string>> {
  const rows = await db().select().from(schema.blocks)
    .where(or(eq(schema.blocks.blockerId, userId), eq(schema.blocks.blockedId, userId)));
  return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));
}

async function followingIds(userId: string): Promise<Set<string>> {
  const rows = await db().select({ id: schema.follows.followedId }).from(schema.follows).where(eq(schema.follows.followerId, userId));
  return new Set(rows.map((r) => r.id));
}

/** Users who share at least one group with this user (including the user). */
async function circle(userId: string): Promise<string[]> {
  const rows = await db().selectDistinct({ id: schema.groupMembers.userId }).from(schema.groupMembers)
    .where(inArray(schema.groupMembers.groupId,
      db().select({ g: schema.groupMembers.groupId }).from(schema.groupMembers).where(eq(schema.groupMembers.userId, userId))));
  return [...new Set([userId, ...rows.map((r) => r.id)])];
}

// ---- groups ----------------------------------------------------------------

export async function createGroup(userId: string, i: { name: string; about?: string; listed?: boolean }) {
  const name = cleanName(i.name), about = cleanAbout(i.about ?? "");
  const b = await hit(`group:create:${userId}`, 10, 86400);
  if (!b.allowed) throw tooMany(b.retryAfter, "You've created a lot of groups today. Try again tomorrow.");
  const id = crypto.randomUUID();
  const inv = await newInvite(userId, id);
  await db().transaction(async (tx) => {
    await tx.insert(schema.groups).values({ id, name, about, listed: i.listed ?? true, createdBy: userId, inviteHash: inv.inviteHash, inviteEnc: inv.inviteEnc, inviteBy: inv.inviteBy });
    await tx.insert(schema.groupMembers).values({ groupId: id, userId, role: "admin" });
    await audit({ type: "group.created", actorId: userId, subjectType: "group", subjectId: id }, tx);
  });
  return { id, name, invite: inviteLink(inv.code) };
}

export async function listGroups(userId: string) {
  const rows = await db().select({ g: schema.groups, role: schema.groupMembers.role }).from(schema.groupMembers)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMembers.groupId))
    .where(eq(schema.groupMembers.userId, userId))
    .orderBy(sql`${schema.groups.lastPostAt} DESC NULLS LAST`, desc(schema.groups.createdAt));
  const ids = rows.map((r) => r.g.id);
  const counts = new Map<string, number>();
  if (ids.length) for (const c of await db().select({ id: schema.groupMembers.groupId, n: count() }).from(schema.groupMembers).where(inArray(schema.groupMembers.groupId, ids)).groupBy(schema.groupMembers.groupId)) counts.set(c.id, c.n);
  const waiting = new Map<string, number>();
  const adminOf = rows.filter((r) => r.role === "admin").map((r) => r.g.id);
  if (adminOf.length) for (const c of await db().select({ id: schema.groupJoinRequests.groupId, n: count() }).from(schema.groupJoinRequests).where(inArray(schema.groupJoinRequests.groupId, adminOf)).groupBy(schema.groupJoinRequests.groupId)) waiting.set(c.id, c.n);
  const mine = await db().select({ g: schema.groups }).from(schema.groupJoinRequests)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.groupJoinRequests.groupId)).where(eq(schema.groupJoinRequests.userId, userId));
  return {
    groups: rows.map((r) => ({ id: r.g.id, name: r.g.name, about: r.g.about, role: r.role, members: counts.get(r.g.id) ?? 1, lastPostAt: r.g.lastPostAt,
      listed: r.g.listed, requests: waiting.get(r.g.id) ?? 0 })),
    /** Groups this person asked to join, still waiting for an admin. */
    pending: mine.map((m) => ({ id: m.g.id, name: m.g.name })),
  };
}

export async function groupDetail(userId: string, groupId: string) {
  const { g, role } = await memberGroup(userId, groupId);
  const ms = await db().select().from(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId)).orderBy(asc(schema.groupMembers.joinedAt));
  const h = await handles(ms.map((m) => m.userId));
  return {
    id: g.id, name: g.name, about: g.about, role, createdAt: g.createdAt, listed: g.listed,
    invite: role === "admin" ? await readInvite(g) : null,
    requests: role === "admin" ? await joinRequests(userId, groupId) : [],
    members: ms.map((m) => ({ id: m.userId, handle: h.get(m.userId) ?? "someone", role: m.role, you: m.userId === userId })),
  };
}

export async function updateGroup(userId: string, groupId: string, i: { name?: string; about?: string; listed?: boolean }) {
  const { role } = await memberGroup(userId, groupId);
  if (role !== "admin") throw forbidden("admin_only", "Only group admins can do that.");
  const set: Partial<Group> = {};
  if (i.name !== undefined) set.name = cleanName(i.name);
  if (i.about !== undefined) set.about = cleanAbout(i.about);
  if (i.listed !== undefined) set.listed = i.listed;
  if (Object.keys(set).length) await db().update(schema.groups).set(set).where(eq(schema.groups.id, groupId));
}

export async function resetInvite(userId: string, groupId: string) {
  const { role } = await memberGroup(userId, groupId);
  if (role !== "admin") throw forbidden("admin_only", "Only group admins can do that.");
  const inv = await newInvite(userId, groupId);
  await db().update(schema.groups).set({ inviteHash: inv.inviteHash, inviteEnc: inv.inviteEnc, inviteBy: inv.inviteBy }).where(eq(schema.groups.id, groupId));
  await audit({ type: "group.invite_reset", actorId: userId, subjectType: "group", subjectId: groupId });
  return { invite: inviteLink(inv.code) };
}

async function groupByInvite(userId: string, input: string) {
  const b = await hit(`group:invite:${userId}`, 30, 3600);
  if (!b.allowed) throw tooMany(b.retryAfter);
  const code = parseInvite(input);
  const [g] = code ? await db().select().from(schema.groups).where(eq(schema.groups.inviteHash, inviteHash(code))) : [];
  if (!g) throw notFound("invite_invalid", "This invite link isn't valid any more. Ask the group admin for a new one.");
  return g;
}

export async function previewInvite(userId: string, input: string) {
  const g = await groupByInvite(userId, input);
  return groupCard(userId, g);
}

async function memberCount(groupId: string) {
  const [{ n }] = await db().select({ n: count() }).from(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
  return n;
}
async function hasRequested(userId: string, groupId: string) {
  const [r] = await db().select().from(schema.groupJoinRequests)
    .where(and(eq(schema.groupJoinRequests.groupId, groupId), eq(schema.groupJoinRequests.userId, userId)));
  return !!r;
}
/** What someone who isn't a member yet may see about a group. */
async function groupCard(userId: string, g: Group) {
  return { id: g.id, name: g.name, about: g.about, members: await memberCount(g.id),
    joined: !!(await roleIn(userId, g.id)), requested: await hasRequested(userId, g.id) };
}

/**
 * Asks to join. Anyone may ask; only the group's creator or its admins can approve. Works for
 * listed groups found in search, and for any group through its invite link.
 */
async function askToJoin(userId: string, g: Group, note: string, via: "search" | "invite") {
  if (await roleIn(userId, g.id)) return { id: g.id, status: "member" as const };
  if (await hasRequested(userId, g.id)) return { id: g.id, status: "requested" as const };
  const n = (note ?? "").trim().slice(0, 200);
  if (n) assertNoContactInfo(n, "note");
  const b = await hit(`group:ask:${userId}`, 20, 3600);
  if (!b.allowed) throw tooMany(b.retryAfter, "You've asked to join a lot of groups. Try again later.");
  if ((await memberCount(g.id)) >= MAX_GROUP_MEMBERS) throw conflict("group_full", "This group is full.");
  await db().insert(schema.groupJoinRequests).values({ groupId: g.id, userId, note: n, via }).onConflictDoNothing();
  await audit({ type: "group.join_requested", actorId: userId, subjectType: "group", subjectId: g.id, payload: { via } });
  const [me] = await db().select({ h: schema.users.handle }).from(schema.users).where(eq(schema.users.id, userId));
  const admins = await db().select({ id: schema.groupMembers.userId }).from(schema.groupMembers)
    .where(and(eq(schema.groupMembers.groupId, g.id), eq(schema.groupMembers.role, "admin")));
  for (const a of admins) {
    await notify(a.id, { kind: "group_join_request", title: `@${me?.h ?? "someone"} asked to join “${g.name}”`, body: n ? `“${n}”` : "Approve or decline in the group.", link: `/groups/${g.id}` })
      .catch((err) => log.warn({ err }, "join request notification failed"));
  }
  return { id: g.id, status: "requested" as const };
}

export async function joinByInvite(userId: string, input: string, note = "") {
  return askToJoin(userId, await groupByInvite(userId, input), note, "invite");
}

export async function requestToJoin(userId: string, groupId: string, note = "") {
  const [g] = await db().select().from(schema.groups).where(eq(schema.groups.id, groupId));
  // Unlisted groups can only be asked to join through their invite link.
  if (!g || (!g.listed && !(await roleIn(userId, g.id)))) throw notFound("group_not_found", "This group doesn't exist or isn't open to requests.");
  return askToJoin(userId, g, note, "search");
}

export async function cancelRequest(userId: string, groupId: string) {
  await db().delete(schema.groupJoinRequests).where(and(eq(schema.groupJoinRequests.groupId, groupId), eq(schema.groupJoinRequests.userId, userId)));
}

/** Listed groups matching a search (by name or description), for people looking for one to join. */
export async function discoverGroups(userId: string, q: string) {
  const b = await hit(`group:search:${userId}`, 120, 3600);
  if (!b.allowed) throw tooMany(b.retryAfter);
  const term = (q ?? "").trim().slice(0, 60);
  const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await db().select().from(schema.groups)
    .where(and(eq(schema.groups.listed, true), term ? or(sql`${schema.groups.name} ILIKE ${like}`, sql`${schema.groups.about} ILIKE ${like}`) : undefined))
    .orderBy(sql`${schema.groups.lastPostAt} DESC NULLS LAST`, desc(schema.groups.createdAt)).limit(30);
  const out = [];
  for (const g of rows) out.push(await groupCard(userId, g));
  return out;
}

/** The join requests waiting for this group's admins. */
export async function joinRequests(adminId: string, groupId: string) {
  const { role } = await memberGroup(adminId, groupId);
  if (role !== "admin") throw forbidden("admin_only", "Only group admins can do that.");
  const rows = await db().select().from(schema.groupJoinRequests).where(eq(schema.groupJoinRequests.groupId, groupId)).orderBy(asc(schema.groupJoinRequests.createdAt));
  const h = await handles(rows.map((r) => r.userId));
  return rows.map((r) => ({ userId: r.userId, handle: h.get(r.userId) ?? "someone", note: r.note, via: r.via, at: r.createdAt }));
}

export async function decideJoin(adminId: string, groupId: string, userId: string, approve: boolean) {
  const { g, role } = await memberGroup(adminId, groupId);
  if (role !== "admin") throw forbidden("admin_only", "Only group admins can do that.");
  const removed = await db().delete(schema.groupJoinRequests)
    .where(and(eq(schema.groupJoinRequests.groupId, groupId), eq(schema.groupJoinRequests.userId, userId))).returning();
  if (removed.length === 0) throw notFound("request_not_found", "That request was already handled or withdrawn.");
  if (!approve) {
    await audit({ type: "group.join_declined", actorId: adminId, subjectType: "group", subjectId: groupId, payload: { userId } });
    return { status: "declined" as const };
  }
  if ((await memberCount(groupId)) >= MAX_GROUP_MEMBERS) throw conflict("group_full", "This group is full.");
  await db().insert(schema.groupMembers).values({ groupId, userId, role: "member" }).onConflictDoNothing();
  await audit({ type: "group.joined", actorId: userId, subjectType: "group", subjectId: groupId, payload: { approvedBy: adminId } });
  await notify(userId, { kind: "group_joined", title: `You're in “${g.name}”`, body: "An admin approved your request.", link: `/groups/${groupId}` })
    .catch((err) => log.warn({ err }, "join approval notification failed"));
  return { status: "approved" as const };
}


/** Leaving as the last admin hands admin to the longest-standing member; the last one out deletes the group. */
export async function leaveGroup(userId: string, groupId: string) {
  const { role } = await memberGroup(userId, groupId);
  await db().transaction(async (tx) => {
    await tx.delete(schema.groupMembers).where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, userId)));
    const rest = await tx.select().from(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId)).orderBy(asc(schema.groupMembers.joinedAt));
    if (rest.length === 0) { await tx.delete(schema.groups).where(eq(schema.groups.id, groupId)); return; }
    if (role === "admin" && !rest.some((m) => m.role === "admin")) {
      await tx.update(schema.groupMembers).set({ role: "admin" }).where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, rest[0].userId)));
    }
    await audit({ type: "group.left", actorId: userId, subjectType: "group", subjectId: groupId }, tx);
  });
}

export async function manageMember(adminId: string, groupId: string, memberId: string, action: "remove" | "make_admin") {
  const { role } = await memberGroup(adminId, groupId);
  if (role !== "admin") throw forbidden("admin_only", "Only group admins can do that.");
  if (memberId === adminId) throw badRequest("self", "Use Leave group instead.");
  const target = await roleIn(memberId, groupId);
  if (!target) throw notFound("member_not_found", "That person isn't in this group.");
  if (action === "make_admin") {
    await db().update(schema.groupMembers).set({ role: "admin" }).where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, memberId)));
    return;
  }
  await db().delete(schema.groupMembers).where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, memberId)));
  await audit({ type: "group.member_removed", actorId: adminId, subjectType: "group", subjectId: groupId, payload: { memberId } });
}

// ---- contact codes on posts ----------------------------------------------

/**
 * Finds or mints this author's contact code for one place (a group, or the status feed).
 * The same code is reused for later posts in the same place while it's still switched on.
 */
const KIND_TOKEN: Record<CodeKind, { class: "standard" | "expiring" | "disposable"; ttlHours?: number }> = {
  standard: { class: "standard" }, day: { class: "expiring", ttlHours: 24 }, one: { class: "disposable" },
};

/** Mints a fresh code for sharing (chats, and one-off or 24-hour codes anywhere). */
export async function mintShareCode(authorId: string, label: string, a: Attach) {
  const k = KIND_TOKEN[a.kind ?? "standard"];
  const { token, codes } = await createToken(authorId, { numberId: a.numberId ?? null, tier: a.tier, class: k.class, ttlHours: k.ttlHours, label: label.slice(0, 40), context: "community" });
  return { tokenId: token.id, short: codes.short, link: codes.link };
}

async function codeFor(authorId: string, place: { groupId: string | null; label: string }, a: Attach) {
  // One-person and 24-hour codes are always new; standing codes are reused in the same place.
  if ((a.kind ?? "standard") !== "standard") return mintShareCode(authorId, place.label, a);
  const prior = await db().select({ p: schema.posts, t: schema.tokens }).from(schema.posts)
    .innerJoin(schema.tokens, eq(schema.tokens.id, schema.posts.tokenId))
    .where(and(eq(schema.posts.authorId, authorId), place.groupId ? eq(schema.posts.groupId, place.groupId) : isNull(schema.posts.groupId),
      isNotNull(schema.posts.codeEnc), a.numberId ? eq(schema.tokens.numberId, a.numberId) : isNull(schema.tokens.numberId), eq(schema.tokens.tier, a.tier),
      eq(schema.tokens.class, "standard"), inArray(schema.tokens.status, [...LIVE_STATUSES])))
    .orderBy(desc(schema.posts.createdAt)).limit(1);
  if (prior[0]) {
    const t = await expireIfDue(prior[0].t);
    if (t.status === "active") {
      const c = JSON.parse(await decryptForUser(authorId, prior[0].p.codeEnc!, `postcode:${prior[0].p.id}`));
      return { tokenId: t.id, short: c.short as string, link: c.link as string };
    }
  }
  return mintShareCode(authorId, place.label, a);
}

async function codeView(p: Post, tokens: Map<string, typeof schema.tokens.$inferSelect>): Promise<CodeView | null> {
  if (!p.codeEnc) return null;
  try {
    const c = JSON.parse(await decryptForUser(p.authorId, p.codeEnc, `postcode:${p.id}`));
    const t = p.tokenId ? tokens.get(p.tokenId) : undefined;
    const expired = !!t && (t.status === "expired" || (!!t.expiresAt && t.expiresAt <= new Date()));
    const state: CodeView["state"] = !t ? "off" : t.status === "consumed" ? "used" : expired ? "expired" : t.status === "active" ? "live" : "off";
    const kind: CodeKind = t?.class === "disposable" ? "one" : t?.class === "expiring" ? "day" : "standard";
    return { short: c.short, link: c.link, tier: t?.tier ?? c.tier ?? 2, live: state === "live", state, kind };
  } catch (err) {
    log.warn({ err, postId: p.id }, "post code unreadable");
    return null;
  }
}

// ---- posts -----------------------------------------------------------------

function cleanText(text: string, hasOther: boolean) {
  const t = (text ?? "").trim();
  if (!t && !hasOther) throw badRequest("empty_post", "Write something or attach media.");
  if (t.length > POST_MAX) throw badRequest("post_too_long", `Keep posts under ${POST_MAX} characters.`);
  return t;
}

export async function createPost(authorId: string, i: { groupId: string | null; text: string; attach?: Attach | null; attachment?: string | null }) {
  let text: string;
  try { text = cleanText(i.text, !!(i.attach || i.attachment)); assertNoContactInfo(text, i.groupId ? "post" : "status"); }
  catch (e) {
    if ((e as { code?: string }).code === "contact_info_detected") {
      await audit({ type: "post.rejected_contact", actorId: authorId, subjectType: i.groupId ? "group" : "status", subjectId: i.groupId });
    }
    throw e;
  }
  let place = { groupId: null as string | null, label: "Status updates" };
  if (i.groupId) {
    const { g } = await memberGroup(authorId, i.groupId);
    place = { groupId: g.id, label: `Group: ${g.name}` };
  }
  const b = await hit(`post:${authorId}`, 30, 3600);
  if (!b.allowed) throw tooMany(b.retryAfter, "You're posting a lot. Try again in a little while.");

  const code = i.attach ? await codeFor(authorId, place, i.attach) : null;
  const attachment = await ownUpload(authorId, i.attachment);
  const id = crypto.randomUUID();
  await db().insert(schema.posts).values({
    id, groupId: place.groupId, authorId, bodyEnc: await encryptForUser(authorId, text, `post:${id}`),
    tokenId: code?.tokenId ?? null,
    codeEnc: code ? await encryptForUser(authorId, JSON.stringify({ short: code.short, link: code.link, tier: i.attach!.tier }), `postcode:${id}`) : null,
    attachment,
    expiresAt: place.groupId ? null : new Date(Date.now() + STATUS_HOURS * 3600_000),
  });
  if (place.groupId) await db().update(schema.groups).set({ lastPostAt: new Date() }).where(eq(schema.groups.id, place.groupId));
  await audit({ type: "post.created", actorId: authorId, subjectType: "post", subjectId: id, payload: { status: !place.groupId, code: !!code } });
  return { id };
}

async function present(viewerId: string, rows: Post[], adminOf: Set<string>) {
  const h = await handles(rows.map((r) => r.authorId));
  const av = await avatars(rows.map((r) => r.authorId));
  const tids = rows.map((r) => r.tokenId).filter(Boolean) as string[];
  const tokens = new Map<string, typeof schema.tokens.$inferSelect>();
  if (tids.length) for (const t of await db().select().from(schema.tokens).where(inArray(schema.tokens.id, tids))) tokens.set(t.id, t);
  const cc = new Map<string, number>();
  if (rows.length) for (const r of await db().select({ postId: schema.comments.postId, n: count() }).from(schema.comments).where(inArray(schema.comments.postId, rows.map((p) => p.id))).groupBy(schema.comments.postId)) cc.set(r.postId, r.n);
  const reacts = rows.length ? await reactionsFor(viewerId, "post", rows.map((p) => p.id)) : new Map();
  const out = [];
  for (const p of rows) {
    let text = "";
    try { text = await decryptForUser(p.authorId, p.bodyEnc, `post:${p.id}`); } catch { continue; }
    out.push({
      id: p.id, at: p.createdAt, expiresAt: p.expiresAt, text,
      author: { id: p.authorId, handle: h.get(p.authorId) ?? "someone", avatar: av.get(p.authorId) ?? null },
      mine: p.authorId === viewerId,
      canDelete: p.authorId === viewerId || (!!p.groupId && adminOf.has(p.groupId)),
      commentCount: cc.get(p.id) ?? 0,
      attachment: p.attachment,
      reactions: reacts.get(p.id) ?? [],
      code: await codeView(p, tokens),
    });
  }
  return out;
}

export async function groupPosts(userId: string, groupId: string, o: { before?: Date } = {}) {
  const { role } = await memberGroup(userId, groupId);
  const blocked = await blockedWith(userId);
  const rows = await db().select().from(schema.posts)
    .where(and(eq(schema.posts.groupId, groupId), o.before ? sql`${schema.posts.createdAt} < ${o.before}` : undefined))
    .orderBy(desc(schema.posts.createdAt)).limit(50);
  return present(userId, rows.filter((r) => !blocked.has(r.authorId)), new Set(role === "admin" ? [groupId] : []));
}

/** Status updates from the last 24 hours by people who share a group with this user. Own first. */
/** Follow another user so their status updates appear in your feed. */
export async function followUser(followerId: string, targetHandle: string) {
  const b = await hit(`follow:${followerId}`, 100, 3600);
  if (!b.allowed) throw tooMany(b.retryAfter, "That's a lot of follows for one hour. Try again later.");
  const u = await userByHandleLocal(targetHandle);
  if (u.id === followerId) throw badRequest("self_follow", "You can’t follow yourself.");
  await db().insert(schema.follows).values({ followerId, followedId: u.id }).onConflictDoNothing();
  return { following: true };
}

export async function unfollowUser(followerId: string, targetHandle: string) {
  const u = await userByHandleLocal(targetHandle);
  await db().delete(schema.follows).where(and(eq(schema.follows.followerId, followerId), eq(schema.follows.followedId, u.id)));
  return { following: false };
}

/** People the user has blocked (so they can unblock them). */
export async function listBlocked(userId: string) {
  const rows = await db().select({ id: schema.blocks.blockedId, at: schema.blocks.createdAt })
    .from(schema.blocks).where(eq(schema.blocks.blockerId, userId))
    .orderBy(desc(schema.blocks.createdAt)).limit(200);
  const h = await handles(rows.map((r) => r.id));
  return rows.map((r) => ({ id: r.id, handle: h.get(r.id) ?? "someone", at: r.at }));
}

export async function unblockUser(userId: string, targetHandle: string) {
  const u = await userByHandleLocal(targetHandle);
  await db().delete(schema.blocks).where(and(eq(schema.blocks.blockerId, userId), eq(schema.blocks.blockedId, u.id)));
  return { unblocked: true };
}

export type PersonCard = { id: string; handle: string; following: boolean; sharesGroups: number; followers: number; liveStatus: boolean; latestAt: string | null };

/**
 * People the viewer may want to follow. Suggestions are the people you already cross paths
 * with: shared groups, your followers, and the people you follow. A handle search can find
 * any user (you can only search for a handle you already know), but blocked users and the
 * viewer themselves are never listed.
 */
export async function discoverPeople(viewerId: string, q: string) {
  const b = await hit(`people:search:${viewerId}`, 120, 3600);
  if (!b.allowed) throw tooMany(b.retryAfter, "That's a lot of searching. Give it a minute.");

  const search = q.trim().toLowerCase().replace(/^@+/, "");
  const [blocked, following, shared, followerRows, live] = await Promise.all([
    blockedWith(viewerId),
    followingIds(viewerId),
    db().select({ id: schema.groupMembers.userId, groups: count() }).from(schema.groupMembers)
      .where(inArray(schema.groupMembers.groupId,
        db().select({ g: schema.groupMembers.groupId }).from(schema.groupMembers).where(eq(schema.groupMembers.userId, viewerId))))
      .groupBy(schema.groupMembers.userId),
    db().select({ id: schema.follows.followerId, n: count() }).from(schema.follows).groupBy(schema.follows.followerId),
    db().select({ id: schema.posts.authorId, at: sql<string>`max(${schema.posts.createdAt})`.as("at") }).from(schema.posts)
      .where(and(isNull(schema.posts.groupId), gt(schema.posts.expiresAt, new Date())))
      .groupBy(schema.posts.authorId),
  ]);

  const sharedCount = new Map(shared.map((r) => [r.id, Number(r.groups)]));
  const followerCount = new Map(followerRows.map((r) => [r.id, Number(r.n)]));
  const liveAt = new Map(live.map((r) => [r.id, r.at]));
  const myFollowers = new Set((await db().select({ id: schema.follows.followerId }).from(schema.follows)
    .where(eq(schema.follows.followedId, viewerId))).map((r) => r.id));

  let rows: { id: string; handle: string }[];
  if (search.length >= 2) {
    // Handle search: you can look up anyone whose handle you know.
    rows = await db().select({ id: schema.users.id, handle: schema.users.handle }).from(schema.users)
      .where(sql`lower(${schema.users.handle}) like ${search + "%"}`).orderBy(asc(schema.users.handle)).limit(24);
  } else {
    // Suggestions: shared groups ∪ people who follow you ∪ people you follow.
    const ids = new Set<string>([...sharedCount.keys(), ...myFollowers, ...following]);
    ids.delete(viewerId);
    if (!ids.size) return [] as PersonCard[];
    rows = await db().select({ id: schema.users.id, handle: schema.users.handle }).from(schema.users)
      .where(inArray(schema.users.id, [...ids])).orderBy(asc(schema.users.handle)).limit(200);
  }

  const cards = rows
    .filter((u) => u.id !== viewerId && !blocked.has(u.id))
    .map((u): PersonCard => ({
      id: u.id, handle: u.handle, following: following.has(u.id),
      sharesGroups: sharedCount.get(u.id) ?? 0, followers: followerCount.get(u.id) ?? 0,
      liveStatus: liveAt.has(u.id), latestAt: liveAt.get(u.id) ?? null,
    }));
  // Suggestions put familiar faces (shared groups, then your followers) on top; a search stays alphabetical.
  if (!search) cards.sort((a, b2) => (b2.sharesGroups - a.sharesGroups) || ((myFollowers.has(b2.id) ? 1 : 0) - (myFollowers.has(a.id) ? 1 : 0)) || (b2.followers - a.followers));
  return cards.slice(0, 24);
}

async function userByHandleLocal(handle: string) {
  const [u] = await db().select().from(schema.users).where(sql`lower(${schema.users.handle}) = ${handle.toLowerCase()}`);
  if (!u) throw notFound("user_not_found", "No user with that handle.");
  return u;
}

/**
 * Status updates from the last 24 hours, visible only to people you share a group with and
 * people who follow you (plus your own). Strangers see nothing.
 */
export async function statusFeed(userId: string) {
  const blocked = await blockedWith(userId);
  const following = await followingIds(userId);
  const visible = new Set(await circle(userId));            // self + shared groups
  for (const id of following) visible.add(id);              // + people I follow
  if (!visible.size) return [];
  const rows = await db().select().from(schema.posts)
    .where(and(isNull(schema.posts.groupId), gt(schema.posts.expiresAt, new Date()),
      inArray(schema.posts.authorId, [...visible])))
    .orderBy(desc(schema.posts.createdAt)).limit(300);
  const items = await present(userId, rows, new Set());
  const by = new Map<string, { author: { id: string; handle: string; avatar: string | null }; you: boolean; following: boolean; latestAt: Date; items: typeof items }>();
  for (const it of items) {
    if (blocked.has(it.author.id)) continue;
    const e = by.get(it.author.id) ?? { author: it.author, you: it.mine, following: following.has(it.author.id), latestAt: it.at, items: [] };
    e.items.push(it); by.set(it.author.id, e);
  }
  for (const e of by.values()) e.items.reverse();   // oldest first, like a story
  return [...by.values()].sort((a, b) => (a.you ? -1 : b.you ? 1 : b.latestAt.getTime() - a.latestAt.getTime()));
}

export async function visiblePost(userId: string, postId: string) {
  const [p] = await db().select().from(schema.posts).where(eq(schema.posts.id, postId));
  if (!p) throw notFound("post_not_found", "This post isn't available.");
  if (p.groupId) {
    const role = await roleIn(userId, p.groupId);
    if (!role) throw notFound("post_not_found", "This post isn't available.");
    return { p, admin: role === "admin" };
  }
  // Status updates are public: any signed-in user can see (and therefore flag/comment on) a live one.
  if (p.authorId !== userId && (!p.expiresAt || p.expiresAt <= new Date())) {
    throw notFound("post_not_found", "This post isn't available.");
  }
  return { p, admin: false };
}

/** Post a comment (or a reply when parentId is set) on any visible post. */
export async function createComment(authorId: string, postId: string, text: string, parentId?: string | null, attachment?: string | null) {
  const b = await hit(`comment:${authorId}`, 60, 3600);
  if (!b.allowed) throw tooMany(b.retryAfter, "You've commented a lot this hour. Give it a rest and try again shortly.");
  const t = cleanText(text, !!attachment);
  assertNoContactInfo(t, "comment");
  const { p } = await visiblePost(authorId, postId);
  if (parentId) {
    const [parent] = await db().select().from(schema.comments).where(eq(schema.comments.id, parentId));
    if (!parent || parent.postId !== p.id) throw notFound("comment_not_found", "That comment isn’t here.");
  }
  const id = crypto.randomUUID();
  const att = await ownUpload(authorId, attachment);
  await db().insert(schema.comments).values({ id, postId, authorId, parentId: parentId ?? null, bodyEnc: await encryptForUser(authorId, t, `comment:${id}`), attachment: att });
  await audit({ type: "post.commented", actorId: authorId, subjectType: "post", subjectId: postId });
  return { id };
}

/** All comments on a post (flat; the client nests replies by parentId). */
export async function listComments(viewerId: string, postId: string) {
  await visiblePost(viewerId, postId);
  const rows = await db().select().from(schema.comments).where(eq(schema.comments.postId, postId)).orderBy(asc(schema.comments.createdAt)).limit(500);
  const h = await handles(rows.map((r) => r.authorId));
  const av = await avatars(rows.map((r) => r.authorId));
  const reacts = rows.length ? await reactionsFor(viewerId, "comment", rows.map((c) => c.id)) : new Map();
  const out = [];
  for (const c of rows) {
    let text = "";
    try { text = await decryptForUser(c.authorId, c.bodyEnc, `comment:${c.id}`); } catch { continue; }
    out.push({ id: c.id, parentId: c.parentId, at: c.createdAt, text, attachment: c.attachment, reactions: reacts.get(c.id) ?? [], author: { id: c.authorId, handle: h.get(c.authorId) ?? "someone", avatar: av.get(c.authorId) ?? null }, mine: c.authorId === viewerId });
  }
  return out;
}

export async function deletePost(userId: string, postId: string) {
  const { p, admin } = await visiblePost(userId, postId);
  if (p.authorId !== userId && !admin) throw forbidden("not_yours", "You can only delete your own posts.");
  await db().delete(schema.posts).where(eq(schema.posts.id, postId));
  if (p.attachment) await deleteUpload(p.attachment);
  await audit({ type: "post.deleted", actorId: userId, subjectType: "post", subjectId: postId, payload: { byAdmin: p.authorId !== userId } });
}

/** Edit your own post (text only; the attachment and contact code stay as they are). */
export async function updatePost(userId: string, postId: string, text: string) {
  const [p] = await db().select().from(schema.posts).where(eq(schema.posts.id, postId));
  if (!p) throw notFound("post_not_found", "This post isn't available.");
  if (p.authorId !== userId) throw forbidden("not_yours", "You can only edit your own posts.");
  if (p.expiresAt && p.expiresAt <= new Date()) throw badRequest("post_expired", "This status has expired.");
  const t = cleanText(text, !!p.codeEnc);
  assertNoContactInfo(t, p.groupId ? "post" : "status");
  await db().update(schema.posts).set({ bodyEnc: await encryptForUser(userId, t, `post:${p.id}`) }).where(eq(schema.posts.id, postId));
  await audit({ type: "post.edited", actorId: userId, subjectType: "post", subjectId: postId });
  return { id: postId };
}

export async function reportPost(userId: string, postId: string, reason: typeof REPORT_REASONS[number], details = "", block = false) {
  const { p } = await visiblePost(userId, postId);
  const text = await decryptForUser(p.authorId, p.bodyEnc, `post:${p.id}`);
  const g = p.groupId ? (await db().select().from(schema.groups).where(eq(schema.groups.id, p.groupId)))[0] : null;
  const r = await createReport(userId, { reason, details, post: { id: p.id, authorId: p.authorId, tokenId: p.tokenId, text, at: p.createdAt, where: g ? `group “${g.name}”` : "status" } });
  if (g) {
    const admins = await db().select({ id: schema.groupMembers.userId }).from(schema.groupMembers)
      .where(and(eq(schema.groupMembers.groupId, g.id), eq(schema.groupMembers.role, "admin")));
    for (const a of admins) if (a.id !== p.authorId && a.id !== userId) {
      await notify(a.id, { kind: "group_report", title: `A post in “${g.name}” was reported`, body: "Open the group to review it. You can delete posts as an admin.", link: `/groups/${g.id}` })
        .catch((err) => log.warn({ err }, "group report notification failed"));
    }
  }
  if (block && p.authorId !== userId) {
    await db().insert(schema.blocks).values({ blockerId: userId, blockedId: p.authorId }).onConflictDoNothing();
    await audit({ type: "chat.blocked", actorId: userId, subjectType: "user", subjectId: p.authorId, payload: { from: "post" } });
  }
  return r;
}

/** Removes status updates older than 24 hours. */
export async function sweepStatuses() {
  const r = await db().delete(schema.posts).where(and(isNull(schema.posts.groupId), sql`${schema.posts.expiresAt} <= now()`)).returning({ id: schema.posts.id, attachment: schema.posts.attachment });
  for (const p of r) if (p.attachment) await deleteUpload(p.attachment);
  return r.length;
}
