import { and, count, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { route, json } from "@/lib/http";
import { requireCodeOwner } from "@/lib/auth";
import { db, schema } from "@/db";
import { decryptForUser } from "@/lib/vault";

/** Owner's Tier 3 requests: pending first, then recent decisions. Never includes caller numbers. */
export const GET = route(async (req) => {
  const ctx = await requireCodeOwner(req);
  const rows = await db().select({ r: schema.decodeRequests, label: schema.tokens.label, numberId: schema.tokens.numberId, caller: schema.users })
    .from(schema.decodeRequests)
    .innerJoin(schema.tokens, eq(schema.tokens.id, schema.decodeRequests.tokenId))
    .innerJoin(schema.users, eq(schema.users.id, schema.decodeRequests.callerId))
    .where(and(eq(schema.decodeRequests.ownerId, ctx.user.id), eq(schema.decodeRequests.tier, 3),
      inArray(schema.decodeRequests.stage, ["consent_pending", "approved_relay", "approved_reveal", "declined", "expired"])))
    .orderBy(desc(schema.decodeRequests.createdAt)).limit(100);
  const out = [];
  for (const { r, label, numberId, caller } of rows) {
    const [reports] = await db().select({ c: count() }).from(schema.reports).where(eq(schema.reports.reportedUserId, caller.id));
    const [prior] = await db().select({ c: count() }).from(schema.decodeRequests)
      .where(and(eq(schema.decodeRequests.ownerId, ctx.user.id), eq(schema.decodeRequests.callerId, caller.id), ne(schema.decodeRequests.id, r.id)));
    // What the owner decides on: is their email confirmed, do they sign in with a second factor.
    const [pk] = await db().select({ c: count() }).from(schema.passkeys).where(eq(schema.passkeys.userId, caller.id));
    const [totp] = await db().select({ c: count() }).from(schema.totpSecrets).where(and(eq(schema.totpSecrets.userId, caller.id), isNotNull(schema.totpSecrets.confirmedAt)));
    out.push({
      id: r.id, stage: r.stage, label, appOnly: !numberId, createdAt: r.createdAt, consentExpiresAt: r.consentExpiresAt, decidedAt: r.decidedAt,
      note: r.noteEnc ? await decryptForUser(ctx.user.id, r.noteEnc, `note:${r.id}`) : null,
      caller: { handle: caller.handle, verification: r.verification, region: r.region, accountCreatedAt: caller.createdAt,
        reports: reports.c, priorRequests: prior.c, emailVerified: !!caller.emailVerifiedAt, passkey: pk.c > 0, authenticator: totp.c > 0,
        avatar: caller.avatarUrl ?? null },
    });
  }
  return json({ requests: out });
});
