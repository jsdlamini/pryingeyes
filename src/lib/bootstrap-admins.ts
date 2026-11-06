/**
 * ADMIN_EMAILS (comma-separated) in .env names the first administrators. Once one of those
 * addresses is verified, that account gets the admin role, so no command has to be run on the
 * server. Recorded in the audit chain. Later admins are added in the app (two-person approval).
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { env } from "./env";

export const adminEmails = () => env().ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

/** Grants admin to verified accounts on the list. Pass a userId to check just that account. */
export async function grantConfiguredAdmins(userId?: string) {
  const list = adminEmails();
  if (!list.length) return 0;
  const where = [inArray(schema.users.email, list), isNotNull(schema.users.emailVerifiedAt)];
  if (userId) where.push(eq(schema.users.id, userId));
  const users = await db().select({ id: schema.users.id, roles: schema.users.roles }).from(schema.users).where(and(...where));
  let n = 0;
  for (const u of users) {
    if (u.roles.includes("admin")) continue;
    await db().update(schema.users).set({ roles: [...u.roles, "admin"] }).where(eq(schema.users.id, u.id));
    await audit({ type: "admin.executed", subjectType: "user", subjectId: u.id, payload: { action: "bootstrap_grant_role", role: "admin", source: "ADMIN_EMAILS" } });
    n++;
  }
  return n;
}
