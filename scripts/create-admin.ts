/**
 * Bootstrap: grant a role to an existing account from the server's shell. After two admins
 * exist, use the in-app dual-control flow instead. Recorded in the audit chain.
 *   npm run admin:create -- --handle=alice --role=admin
 */
import "./load-env";
import { sql, eq } from "drizzle-orm";
import { db, closeDb, schema } from "@/db";
import { closeRedis } from "@/lib/redis";
import { audit } from "@/lib/audit";

async function main() {
  const handle = process.argv.find((a) => a.startsWith("--handle="))?.slice(9);
  const role = process.argv.find((a) => a.startsWith("--role="))?.slice(7) ?? "admin";
  if (!handle || !["admin", "moderator"].includes(role)) throw new Error("Usage: npm run admin:create -- --handle=<handle> --role=admin|moderator");
  const [u] = await db().select().from(schema.users).where(sql`lower(${schema.users.handle}) = ${handle.toLowerCase()}`);
  if (!u) throw new Error(`No user @${handle}. They must sign up first.`);
  const roles = [...new Set([...u.roles, role])];
  await db().update(schema.users).set({ roles }).where(eq(schema.users.id, u.id));
  await audit({ type: "admin.executed", subjectType: "user", subjectId: u.id, payload: { action: "bootstrap_grant_role", role } });
  console.log(`@${u.handle} now has roles: ${roles.join(", ")}`);
  await closeDb(); await closeRedis();
}
main().catch(async (e) => { console.error(e.message ?? e); await closeDb(); await closeRedis(); process.exit(1); });
