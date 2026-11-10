/**
 * Tokens (rules 4–6). Plaintext codes exist only in the response to the owner who created them.
 * The database holds HMAC-SHA256(code, pepper) for the link code and the short code.
 */
import { and, count, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, schema, type DB } from "@/db";
import { audit } from "./audit";
import { groupCode, hmacHex, isCrockford, normaliseCrockford, randomCrockford, timingSafeEqualHex } from "./crypto";
import { tokenPepper } from "./keys";
import { env } from "./env";
import { badRequest, conflict, forbidden, notFound } from "./errors";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Token = typeof schema.tokens.$inferSelect;
export type TokenClass = "standard" | "expiring" | "disposable" | "purpose";
export type Context = "business" | "classifieds" | "community" | "marketplace" | "dating" | "new_contact" | "other";

export const LINK_CHARS = 16; // 80 bits
export const SHORT_CHARS = 10; // 50 bits
export const LIVE_STATUSES = ["active", "paused", "frozen"] as const;

export const linkHash = (code: string) => hmacHex(tokenPepper(), `link:${code}`);
export const shortHash = (code: string) => hmacHex(tokenPepper(), `short:${code}`);

/** Tier recommendation from the owner's context (rule 6). */
export function recommend(context: Context): { tier: 1 | 2 | 3; class: TokenClass; ttlHours: number | null } {
  switch (context) {
    case "business": return { tier: 1, class: "standard", ttlHours: null };
    case "classifieds":
    case "community": return { tier: 2, class: "standard", ttlHours: null };
    case "marketplace":
    case "dating":
    case "new_contact": return { tier: 3, class: "expiring", ttlHours: 48 };
    default: return { tier: 2, class: "standard", ttlHours: null };
  }
}

export interface ShareCodes { link: string; short: string; linkCode: string; shortCode: string }
const shareCodes = (linkCode: string, shortCode: string): ShareCodes => ({
  linkCode, shortCode,
  link: `${env().APP_URL}/t/${groupCode(linkCode)}`,
  short: groupCode(shortCode, 5),
});

export interface CreateInput {
  /** Omit (or null) for an app-only code: message and in-app call, no number behind it. */
  numberId?: string | null; tier: number; class: TokenClass; label: string; context?: Context;
  ttlHours?: number | null; decodeBudget?: number | null;
}

function validate(i: CreateInput) {
  if (i.tier === 4) throw badRequest("tier_unavailable", "Vault (Tier 4) is coming soon.");
  if (![1, 2, 3].includes(i.tier)) throw badRequest("invalid_tier", "Choose a protection tier.");
  const label = (i.label ?? "").trim();
  if (label.length < 1 || label.length > 40) throw badRequest("invalid_label", "Give this token a label of up to 40 characters.");
  if (i.ttlHours != null && (i.ttlHours < 1 || i.ttlHours > 24 * 365)) throw badRequest("invalid_ttl", "Choose an expiry between 1 hour and 1 year.");
  if (i.decodeBudget != null && (i.decodeBudget < 1 || i.decodeBudget > 10000)) throw badRequest("invalid_budget", "Choose a limit between 1 and 10,000.");
}

async function insertToken(tx: Tx, ownerId: string, i: CreateInput, rotatedFromId?: string) {
  const now = Date.now();
  const ttl = i.class === "expiring" ? (i.ttlHours ?? 48) : i.ttlHours ?? null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const linkCode = randomCrockford(LINK_CHARS), shortCode = randomCrockford(SHORT_CHARS);
    try {
      const [t] = await tx.insert(schema.tokens).values({
        ownerId, numberId: i.numberId ?? null, linkHash: linkHash(linkCode), shortHash: shortHash(shortCode),
        displayPrefix: linkCode.slice(0, 4), class: i.class, tier: i.tier, context: i.context ?? "other",
        label: i.label.trim(), expiresAt: ttl ? new Date(now + ttl * 3600_000) : null,
        decodeBudget: i.class === "disposable" ? 1 : i.decodeBudget ?? null,
        rotationDueAt: i.class === "purpose" ? new Date(now + 90 * 86400_000) : null,
        rotatedFromId: rotatedFromId ?? null,
      }).returning();
      return { token: t, codes: shareCodes(linkCode, shortCode) };
    } catch (e: any) {
      if (String(e?.cause?.code ?? e?.code) !== "23505") throw e; // retry only on (astronomically unlikely) collision
    }
  }
  throw new Error("could not allocate token");
}

export async function createToken(ownerId: string, i: CreateInput) {
  validate(i);
  return db().transaction(async (tx) => {
    const numberId = i.numberId ?? null;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${numberId ?? `app:${ownerId}`}))`);
    if (numberId) {
      const [num] = await tx.select().from(schema.phoneNumbers)
        .where(and(eq(schema.phoneNumbers.id, numberId), eq(schema.phoneNumbers.userId, ownerId), eq(schema.phoneNumbers.kind, "protected")));
      if (!num) throw notFound("number_not_found", "Add this number first.");
    }
    const [{ c }] = await tx.select({ c: count() }).from(schema.tokens)
      .where(and(numberId ? eq(schema.tokens.numberId, numberId) : and(eq(schema.tokens.ownerId, ownerId), isNull(schema.tokens.numberId)),
        inArray(schema.tokens.status, [...LIVE_STATUSES])));
    if (c >= env().MAX_TOKENS_PER_NUMBER) throw conflict("token_cap", `You can have up to ${env().MAX_TOKENS_PER_NUMBER} active codes${numberId ? " per number" : ""}. Revoke one first.`);
    const r = await insertToken(tx, ownerId, i);
    await audit({ type: "token.created", actorId: ownerId, ownerId, subjectType: "token", subjectId: r.token.id,
      payload: { tier: i.tier, class: i.class, appOnly: !i.numberId } }, tx);
    return r;
  });
}

/** Whether a code (or the code behind a request) is backed by a phone number. */
export async function tokenHasNumber(ownerId: string, tokenId: string) {
  if (!/^[0-9a-f-]{36}$/.test(tokenId)) return false;
  const [t] = await db().select({ n: schema.tokens.numberId }).from(schema.tokens).where(and(eq(schema.tokens.id, tokenId), eq(schema.tokens.ownerId, ownerId)));
  return !!t?.n;
}
export async function requestHasNumber(ownerId: string, requestId: string) {
  if (!/^[0-9a-f-]{36}$/.test(requestId)) return false;
  const [r] = await db().select({ n: schema.tokens.numberId }).from(schema.decodeRequests).innerJoin(schema.tokens, eq(schema.tokens.id, schema.decodeRequests.tokenId))
    .where(and(eq(schema.decodeRequests.id, requestId), eq(schema.decodeRequests.ownerId, ownerId)));
  return !!r?.n;
}

/** Parses a link code or short code from any human-entered form. */
export function parseCode(input: string): { kind: "link" | "short"; hash: string } | null {
  const raw = (input ?? "").trim();
  const fromUrl = raw.match(/\/t\/([^/?#\s]+)/)?.[1] ?? raw;
  const s = normaliseCrockford(decodeURIComponent(fromUrl));
  if (!isCrockford(s)) return null;
  if (s.length === LINK_CHARS) return { kind: "link", hash: linkHash(s) };
  if (s.length === SHORT_CHARS) return { kind: "short", hash: shortHash(s) };
  return null;
}

/** Looks a token up by code. Expired tokens are marked expired on read. */
export async function findByCode(input: string): Promise<Token | null> {
  const p = parseCode(input);
  if (!p) return null;
  const col = p.kind === "link" ? schema.tokens.linkHash : schema.tokens.shortHash;
  const [t] = await db().select().from(schema.tokens).where(eq(col, p.hash));
  if (!t) return null;
  if (!timingSafeEqualHex(p.kind === "link" ? t.linkHash : t.shortHash, p.hash)) return null;
  return expireIfDue(t);
}

export async function expireIfDue(t: Token): Promise<Token> {
  if (t.expiresAt && t.expiresAt <= new Date() && (t.status === "active" || t.status === "paused" || t.status === "frozen")) {
    await db().update(schema.tokens).set({ status: "expired", updatedAt: new Date() }).where(eq(schema.tokens.id, t.id));
    await audit({ type: "token.expired", ownerId: t.ownerId, subjectType: "token", subjectId: t.id });
    return { ...t, status: "expired" };
  }
  return t;
}

async function ownedToken(ownerId: string, tokenId: string, exec: DB | Tx = db()) {
  const [t] = await exec.select().from(schema.tokens).where(and(eq(schema.tokens.id, tokenId), eq(schema.tokens.ownerId, ownerId)));
  if (!t) throw notFound("token_not_found", "Token not found.");
  return t;
}

const TRANSITIONS: Record<string, { from: string[]; to: Token["status"]; audit: "token.paused" | "token.resumed" | "token.revoked" | "token.unfrozen" }> = {
  pause: { from: ["active"], to: "paused", audit: "token.paused" },
  resume: { from: ["paused", "frozen"], to: "active", audit: "token.resumed" },
  revoke: { from: ["active", "paused", "frozen"], to: "revoked", audit: "token.revoked" },
};

export async function setTokenState(ownerId: string, tokenId: string, action: keyof typeof TRANSITIONS) {
  const tr = TRANSITIONS[action];
  const t = await ownedToken(ownerId, tokenId);
  if (!tr.from.includes(t.status)) throw conflict("invalid_state", `This token is ${t.status}.`);
  if (action === "resume" && t.expiresAt && t.expiresAt <= new Date()) throw conflict("expired", "This token has expired. Extend it first.");
  await db().transaction(async (tx) => {
    await tx.update(schema.tokens).set({ status: tr.to, updatedAt: new Date() }).where(eq(schema.tokens.id, tokenId));
    await audit({ type: tr.audit, actorId: ownerId, ownerId, subjectType: "token", subjectId: tokenId }, tx);
  });
}

/** Atomically issues new codes with the same settings and revokes the old token. */
export async function rotateToken(ownerId: string, tokenId: string) {
  return db().transaction(async (tx) => {
    const t = await ownedToken(ownerId, tokenId, tx);
    if (!["active", "paused", "frozen", "expired"].includes(t.status)) throw conflict("invalid_state", `This token is ${t.status}.`);
    const remaining = t.expiresAt ? Math.max(1, Math.ceil((t.expiresAt.getTime() - Date.now()) / 3600_000)) : null;
    const r = await insertToken(tx, ownerId, {
      numberId: t.numberId, tier: t.tier, class: t.class, label: t.label, context: t.context as Context,
      ttlHours: t.status === "expired" ? (t.class === "expiring" ? 48 : null) : remaining,
      decodeBudget: t.decodeBudget,
    }, t.id);
    await tx.update(schema.tokens).set({ status: "revoked", updatedAt: new Date() }).where(eq(schema.tokens.id, t.id));
    await audit({ type: "token.rotated", actorId: ownerId, ownerId, subjectType: "token", subjectId: t.id, payload: { newTokenId: r.token.id } }, tx);
    return r;
  });
}

export async function cloneToken(ownerId: string, tokenId: string, changes: Partial<CreateInput>) {
  const t = await ownedToken(ownerId, tokenId);
  return createToken(ownerId, {
    numberId: t.numberId, tier: changes.tier ?? t.tier, class: changes.class ?? t.class,
    label: changes.label ?? t.label, context: (changes.context ?? t.context) as Context,
    ttlHours: changes.ttlHours ?? (t.class === "expiring" ? 48 : null), decodeBudget: changes.decodeBudget ?? t.decodeBudget,
  });
}

export async function extendToken(ownerId: string, tokenId: string, hours: number) {
  if (!(hours >= 1 && hours <= 24 * 90)) throw badRequest("invalid_ttl", "Extend by between 1 hour and 90 days.");
  const t = await ownedToken(ownerId, tokenId);
  if (!["active", "paused", "frozen", "expired"].includes(t.status)) throw conflict("invalid_state", `This token is ${t.status}.`);
  const base = t.expiresAt && t.expiresAt > new Date() ? t.expiresAt.getTime() : Date.now();
  const status = t.status === "expired" ? "active" : t.status;
  await db().update(schema.tokens).set({ expiresAt: new Date(base + hours * 3600_000), status, updatedAt: new Date() }).where(eq(schema.tokens.id, tokenId));
  await audit({ type: "token.extended", actorId: ownerId, ownerId, subjectType: "token", subjectId: tokenId, payload: { hours } });
}

/** Counts one delivered outcome; disposable/budgeted tokens become consumed (rule 5). */
export async function countOutcome(tokenId: string, exec: DB | Tx = db()) {
  const [t] = await exec.update(schema.tokens).set({ uses: sql`${schema.tokens.uses} + 1`, updatedAt: new Date() })
    .where(eq(schema.tokens.id, tokenId)).returning();
  if (t && t.decodeBudget != null && t.uses >= t.decodeBudget && t.status === "active") {
    await exec.update(schema.tokens).set({ status: "consumed" }).where(eq(schema.tokens.id, tokenId));
    await audit({ type: "token.consumed", ownerId: t.ownerId, subjectType: "token", subjectId: tokenId }, exec);
  }
}

export async function freezeToken(tokenId: string, reason: string) {
  const r = await db().update(schema.tokens).set({ status: "frozen", updatedAt: new Date() })
    .where(and(eq(schema.tokens.id, tokenId), eq(schema.tokens.status, "active"))).returning();
  if (r[0]) await audit({ type: "token.frozen", ownerId: r[0].ownerId, subjectType: "token", subjectId: tokenId, payload: { reason } });
  return r[0] ?? null;
}

/** Panic revoke-all (rule 11): one statement, every live token on the account. */
export async function panicRevokeAll(ownerId: string) {
  return db().transaction(async (tx) => {
    const r = await tx.update(schema.tokens).set({ status: "revoked", updatedAt: new Date() })
      .where(and(eq(schema.tokens.ownerId, ownerId), inArray(schema.tokens.status, ["active", "paused", "frozen", "expired"])))
      .returning({ id: schema.tokens.id });
    await tx.update(schema.users).set({ panicAt: new Date() }).where(eq(schema.users.id, ownerId));
    // Pending consent requests can no longer be granted.
    await tx.update(schema.decodeRequests).set({ stage: "declined", decidedAt: new Date() })
      .where(and(eq(schema.decodeRequests.ownerId, ownerId), inArray(schema.decodeRequests.stage, ["started", "otp_sent", "verified", "consent_pending", "approved_relay", "approved_reveal"])));
    await audit({ type: "panic.revoke_all", actorId: ownerId, ownerId, payload: { revoked: r.length } }, tx);
    return r.length;
  });
}

/** Owner view of tokens. Codes are never retrievable after minting: only the 4-character prefix. */
export async function listTokens(ownerId: string) {
  const rows = await db().select({
    t: schema.tokens, hint: schema.phoneNumbers.hint, numberLabel: schema.phoneNumbers.label,
  }).from(schema.tokens).leftJoin(schema.phoneNumbers, eq(schema.phoneNumbers.id, schema.tokens.numberId))
    .where(eq(schema.tokens.ownerId, ownerId)).orderBy(sql`${schema.tokens.createdAt} DESC`);
  const now = new Date();
  const tids = rows.map((r) => r.t.id);
  const contactRows = tids.length ? await db().select({ tokenId: schema.conversations.tokenId, n: sql<number>`count(distinct ${schema.conversations.callerId})` })
    .from(schema.conversations).where(inArray(schema.conversations.tokenId, tids)).groupBy(schema.conversations.tokenId) : [];
  const contacts = new Map(contactRows.map((r) => [r.tokenId, Number(r.n)]));
  return rows.map(({ t, hint, numberLabel }) => ({
    id: t.id, label: t.label, class: t.class, tier: t.tier, context: t.context,
    status: t.expiresAt && t.expiresAt <= now && LIVE_STATUSES.includes(t.status as any) ? "expired" : t.status,
    displayPrefix: t.displayPrefix,
    expiresAt: t.expiresAt, uses: t.uses, decodeBudget: t.decodeBudget,
    rotationDue: !!(t.rotationDueAt && t.rotationDueAt <= now), createdAt: t.createdAt,
    appOnly: !t.numberId,
    contacts: contacts.get(t.id) ?? 0,
    number: t.numberId ? { id: t.numberId, hint, label: numberLabel } : null,
  }));
}

export function assertNotDuringPanicWithoutStepUp(user: { panicAt: Date | null }, mfaAt: Date | null) {
  if (user.panicAt && (!mfaAt || mfaAt < user.panicAt))
    throw forbidden("step_up_required", "After a panic revoke, confirm it's you before issuing new tokens.");
}

export { lt };
