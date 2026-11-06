/**
 * Development seed: a ready-to-use owner (password + authenticator), a moderator/admin pair,
 * a caller, and one token per tier. Synthetic numbers only. Refuses to run outside development.
 * Credentials and links are printed and written to var/seed-credentials.txt.
 */
import "./load-env";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db, closeDb, schema } from "@/db";
import { closeRedis } from "@/lib/redis";
import { env } from "@/lib/env";
import { hashPassword } from "@/lib/password";
import { encryptForUser, storeNumber } from "@/lib/vault";
import { newTotpSecret, otpauthUri } from "@/lib/totp";
import { createToken } from "@/lib/tokens";
import { generateRecoveryCodes } from "@/lib/accounts";
import { synthetic } from "./script-helpers";

const PASSWORD = "pryingeyes demo password";

async function user(handle: string, email: string, roles: string[] = []) {
  const existing = await db().select().from(schema.users).where(eq(schema.users.email, email));
  if (existing[0]) return { u: existing[0], secret: null as string | null, created: false };
  const [u] = await db().insert(schema.users).values({ handle, email, emailVerifiedAt: new Date(), passwordHash: await hashPassword(PASSWORD),
    status: "active", ageConfirmedAt: new Date(), roles }).returning();
  const secret = newTotpSecret();
  await db().insert(schema.totpSecrets).values({ userId: u.id, secretEnc: await encryptForUser(u.id, secret, `totp:${u.id}`), confirmedAt: new Date() });
  return { u, secret, created: true };
}

async function main() {
  if (env().APP_ENV !== "development") throw new Error("The seed only runs with APP_ENV=development.");
  const lines: string[] = [`PryingEyes development seed — ${new Date().toISOString()}`, `Password for every seeded email account: ${PASSWORD}`, ""];
  const owner = await user("demo_owner", "owner@demo.pryingeyes.local");
  const mod = await user("demo_moderator", "moderator@demo.pryingeyes.local", ["moderator"]);
  const a1 = await user("demo_admin_one", "admin1@demo.pryingeyes.local", ["admin"]);
  const a2 = await user("demo_admin_two", "admin2@demo.pryingeyes.local", ["admin"]);
  for (const [name, x] of [["Owner", owner], ["Moderator", mod], ["Admin 1", a1], ["Admin 2", a2]] as const) {
    lines.push(`${name}: ${x.u.email} (@${x.u.handle})`);
    if (x.secret) lines.push(`  Authenticator key: ${x.secret}`, `  otpauth URI: ${otpauthUri(x.secret, `@${x.u.handle}`)}`);
    else lines.push("  (already existed — authenticator key unchanged)");
  }
  if (owner.created) {
    const codes = await generateRecoveryCodes(owner.u.id);
    lines.push(`  Owner recovery codes: ${codes.slice(0, 3).join("  ")} …`);
    const num = await storeNumber(owner.u.id, synthetic(), "protected", "Demo mobile");
    lines.push("", "Tokens (copy these — they can't be shown again):");
    for (const [tier, label, cls] of [[1, "Salon bookings", "standard"], [2, "Choir group", "standard"], [3, "Marketplace phone", "expiring"]] as const) {
      const t = await createToken(owner.u.id, { numberId: num.id, tier, class: cls, label, ttlHours: cls === "expiring" ? 168 : null });
      lines.push(`  T${tier} ${label}: ${t.codes.link}   short code ${t.codes.short}`);
    }
  }
  lines.push("", "Callers: open a token link in a private window and sign up with any phone number; the SMS code appears at /dev/outbox.");
  fs.mkdirSync("var", { recursive: true });
  fs.writeFileSync("var/seed-credentials.txt", lines.join("\n") + "\n", { mode: 0o600 });
  console.log(lines.join("\n"));
  await closeDb(); await closeRedis();
}
main().catch(async (e) => { console.error(e.message ?? e); await closeDb(); await closeRedis(); process.exit(1); });
