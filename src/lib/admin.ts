/**
 * Break-glass administration (rule 14): every action needs two different administrators —
 * one to request, another to approve — and every step is written to the audit chain.
 */
import { and, count, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { badRequest, conflict, forbidden, notFound } from "./errors";
import { rewrapAllDataKeys } from "./vault";
import { revokeOtherSessions } from "./session";
import { env } from "./env";
import { groupCode } from "./crypto";

export const AdminAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend_user"), handle: z.string().max(24) }),
  z.object({ action: z.literal("unsuspend_user"), handle: z.string().max(24) }),
  z.object({ action: z.literal("grant_role"), handle: z.string().max(24), role: z.enum(["moderator", "admin"]) }),
  z.object({ action: z.literal("revoke_role"), handle: z.string().max(24), role: z.enum(["moderator", "admin"]) }),
  z.object({ action: z.literal("rewrap_keys") }),
]);
export type AdminActionInput = z.infer<typeof AdminAction>;

async function userByHandle(handle: string) {
  const [u] = await db().select().from(schema.users).where(sql`lower(${schema.users.handle}) = ${handle.toLowerCase()}`);
  if (!u) throw notFound("user_not_found", "No user with that handle.");
  return u;
}

export async function requestAdminAction(adminId: string, input: AdminActionInput, reason: string) {
  if (!reason || reason.trim().length < 10) throw badRequest("reason_required", "Explain why (at least 10 characters).");
  if ("handle" in input) await userByHandle(input.handle);
  const { action, ...params } = input;
  const [a] = await db().insert(schema.adminActions).values({
    action, params, reason: reason.trim().slice(0, 500), requestedBy: adminId, expiresAt: new Date(Date.now() + 24 * 3600_000),
  }).returning();
  await audit({ type: "admin.requested", actorId: adminId, subjectType: "admin_action", subjectId: a.id, payload: { action } });
  return a;
}

async function execute(a: typeof schema.adminActions.$inferSelect): Promise<string> {
  const p = a.params as Record<string, string>;
  switch (a.action) {
    case "suspend_user": {
      const u = await userByHandle(p.handle);
      await db().update(schema.users).set({ status: "suspended" }).where(eq(schema.users.id, u.id));
      await revokeOtherSessions(u.id);
      await audit({ type: "account.suspended", actorId: a.approvedBy, ownerId: u.id, subjectType: "user", subjectId: u.id });
      return `suspended @${u.handle}`;
    }
    case "unsuspend_user": {
      const u = await userByHandle(p.handle);
      await db().update(schema.users).set({ status: "active" }).where(eq(schema.users.id, u.id));
      await audit({ type: "account.unsuspended", actorId: a.approvedBy, ownerId: u.id, subjectType: "user", subjectId: u.id });
      return `unsuspended @${u.handle}`;
    }
    case "grant_role":
    case "revoke_role": {
      const u = await userByHandle(p.handle);
      const roles = new Set(u.roles);
      if (a.action === "grant_role") roles.add(p.role); else roles.delete(p.role);
      await db().update(schema.users).set({ roles: [...roles] }).where(eq(schema.users.id, u.id));
      return `${a.action === "grant_role" ? "granted" : "revoked"} ${p.role} for @${u.handle}`;
    }
    case "rewrap_keys":
      return `re-wrapped ${await rewrapAllDataKeys()} data keys under the current KEK`;
    default:
      throw badRequest("unknown_action");
  }
}

export async function decideAdminAction(adminId: string, id: string, approve: boolean) {
  const [a] = await db().select().from(schema.adminActions).where(eq(schema.adminActions.id, id));
  if (!a) throw notFound();
  if (a.status !== "pending") throw conflict("already_decided", "Already decided.");
  if (a.expiresAt < new Date()) {
    await db().update(schema.adminActions).set({ status: "expired" }).where(eq(schema.adminActions.id, id));
    throw conflict("expired", "This request expired.");
  }
  if (a.requestedBy === adminId) throw forbidden("dual_control", "A different administrator must approve this.");
  if (!approve) {
    await db().update(schema.adminActions).set({ status: "rejected", approvedBy: adminId, decidedAt: new Date() }).where(eq(schema.adminActions.id, id));
    await audit({ type: "admin.rejected", actorId: adminId, subjectType: "admin_action", subjectId: id });
    return { status: "rejected" };
  }
  const claimed = await db().update(schema.adminActions).set({ approvedBy: adminId, decidedAt: new Date(), status: "executed" })
    .where(and(eq(schema.adminActions.id, id), eq(schema.adminActions.status, "pending"))).returning();
  if (!claimed[0]) throw conflict("already_decided", "Already decided.");
  await audit({ type: "admin.approved", actorId: adminId, subjectType: "admin_action", subjectId: id });
  const result = await execute(claimed[0]);
  await db().update(schema.adminActions).set({ result }).where(eq(schema.adminActions.id, id));
  await audit({ type: "admin.executed", actorId: adminId, subjectType: "admin_action", subjectId: id, payload: { action: a.action } });
  return { status: "executed", result };
}

/** Read-only view of every code (active and historical) a user owns. Admin only. */
export async function listUserTokens(handle: string) {
  const u = await userByHandle(handle);
  const rows = await db().select().from(schema.tokens).where(eq(schema.tokens.ownerId, u.id)).orderBy(desc(schema.tokens.createdAt));
  return {
    user: { id: u.id, handle: u.handle, email: u.email, status: u.status },
    tokens: rows.map((t) => ({
      id: t.id, label: t.label, class: t.class, tier: t.tier, status: t.status,
      displayPrefix: t.displayPrefix, linkCode: t.linkCode, shortCode: t.shortCode,
      link: t.linkCode ? `${env().APP_URL}/t/${groupCode(t.linkCode)}` : null,
      short: t.shortCode ? groupCode(t.shortCode, 5) : null,
      uses: t.uses, decodeBudget: t.decodeBudget, expiresAt: t.expiresAt, createdAt: t.createdAt,
    })),
  };
}

/** Directory of all users with code counts. Admin only. */
export async function listUsers() {
  const rows = await db().select().from(schema.users).orderBy(desc(schema.users.createdAt)).limit(500);
  const counts = await db().select({ ownerId: schema.tokens.ownerId, c: count() }).from(schema.tokens).groupBy(schema.tokens.ownerId);
  const codeCounts = new Map(counts.map((r) => [r.ownerId, Number(r.c)]));
  return rows.map((u) => ({
    id: u.id, handle: u.handle, email: u.email, status: u.status, roles: u.roles,
    emailVerified: !!u.emailVerifiedAt, createdAt: u.createdAt, codeCount: codeCounts.get(u.id) ?? 0,
  }));
}

/** Direct single-admin action (suspend / unsuspend / grant_role / revoke_role). Audited. */
export async function directAdminAction(adminId: string, input: AdminActionInput, reason: string) {
  const r = (reason ?? "").trim();
  if (r.length < 4) throw badRequest("reason_required", "Explain why (at least 4 characters).");
  const { action } = input;
  let result: string;
  if (action === "suspend_user" || action === "unsuspend_user") {
    const u = await userByHandle(input.handle);
    await db().update(schema.users).set({ status: action === "suspend_user" ? "suspended" : "active" }).where(eq(schema.users.id, u.id));
    if (action === "suspend_user") await revokeOtherSessions(u.id);
    await audit({ type: action === "suspend_user" ? "account.suspended" : "account.unsuspended", actorId: adminId, ownerId: u.id, subjectType: "user", subjectId: u.id, payload: { reason: r } });
    result = `${action === "suspend_user" ? "suspended" : "unsuspended"} @${u.handle}`;
  } else if (action === "grant_role" || action === "revoke_role") {
    const u = await userByHandle(input.handle);
    const roles = new Set(u.roles);
    if (action === "grant_role") roles.add(input.role); else roles.delete(input.role);
    await db().update(schema.users).set({ roles: [...roles] }).where(eq(schema.users.id, u.id));
    await audit({ type: "admin.executed", actorId: adminId, subjectType: "user", subjectId: u.id, payload: { action, role: input.role, reason: r } });
    result = `${action === "grant_role" ? "granted" : "revoked"} ${input.role} for @${u.handle}`;
  } else {
    throw badRequest("unsupported", "That action still needs two-person approval.");
  }
  return { result };
}

export async function listAdminActions() {
  const rows = await db().select({ a: schema.adminActions, by: schema.users.handle }).from(schema.adminActions)
    .leftJoin(schema.users, eq(schema.users.id, schema.adminActions.requestedBy))
    .orderBy(desc(schema.adminActions.createdAt)).limit(100);
  return rows.map(({ a, by }) => ({ ...a, requestedByHandle: by }));
}

export async function expireAdminActions() {
  const r = await db().update(schema.adminActions).set({ status: "expired" })
    .where(and(eq(schema.adminActions.status, "pending"), lt(schema.adminActions.expiresAt, new Date())));
  return r.rowCount ?? 0;
}
