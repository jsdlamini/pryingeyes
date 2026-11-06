/** Scheduled housekeeping (rules 12 and 15). Safe to run repeatedly. */
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { anchorDay, audit } from "./audit";
import { expireStaleConsent } from "./gate";
import { purgeExpiredMessages } from "./chat";
import { expireAdminActions } from "./admin";
import { log } from "./log";

const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000);

export async function runRetention() {
  const r: Record<string, number> = {};
  r.consentExpired = await expireStaleConsent();

  const expTokens = await db().update(schema.tokens).set({ status: "expired", updatedAt: new Date() })
    .where(and(inArray(schema.tokens.status, ["active", "paused", "frozen"]), isNotNull(schema.tokens.expiresAt), lt(schema.tokens.expiresAt, new Date())))
    .returning({ id: schema.tokens.id, ownerId: schema.tokens.ownerId });
  for (const t of expTokens) await audit({ type: "token.expired", ownerId: t.ownerId, subjectType: "token", subjectId: t.id });
  r.tokensExpired = expTokens.length;

  r.messagesPurged = await purgeExpiredMessages();
  const { sweepCalls } = await import("./calls");
  r.callsSettled = await sweepCalls(true);
  const { sweepStatuses } = await import("./social");
  r.statusesExpired = await sweepStatuses();
  // In-app call metadata (who, when, how long) is kept for 12 months.
  r.callsPurged = (await db().delete(schema.appCalls).where(lt(schema.appCalls.createdAt, daysAgo(365)))).rowCount ?? 0;
  r.otpPurged = (await db().delete(schema.otpChallenges).where(lt(schema.otpChallenges.createdAt, daysAgo(90)))).rowCount ?? 0;
  r.verificationPurged = (await db().delete(schema.verificationTokens).where(lt(schema.verificationTokens.expiresAt, daysAgo(90)))).rowCount ?? 0;
  r.grantsPurged = (await db().delete(schema.revealGrants).where(lt(schema.revealGrants.expiresAt, daysAgo(1)))).rowCount ?? 0;
  r.sessionsPurged = (await db().delete(schema.sessions)
    .where(or(lt(schema.sessions.expiresAt, daysAgo(1)), and(isNotNull(schema.sessions.revokedAt), lt(schema.sessions.revokedAt, daysAgo(30)))))).rowCount ?? 0;
  // Intro notes are kept for 30 days after the request closes.
  r.notesCleared = (await db().update(schema.decodeRequests).set({ noteEnc: null })
    .where(and(isNotNull(schema.decodeRequests.noteEnc), lt(schema.decodeRequests.expiresAt, daysAgo(30))))).rowCount ?? 0;
  r.devOutboxPurged = (await db().delete(schema.devOutbox).where(lt(schema.devOutbox.createdAt, daysAgo(7)))).rowCount ?? 0;
  r.adminExpired = await expireAdminActions();

  // Audit retention: per-owner window (1–24 months); events with no owner keep 12 months.
  // Payloads are nulled; hashes stay so the chain continues to verify.
  const owned = await db().execute(sql`
    UPDATE audit_events a SET payload = NULL FROM users u
    WHERE a.owner_id = u.id AND a.payload IS NOT NULL
      AND a.at < now() - make_interval(months => u.audit_retention_months)`);
  const orphan = await db().update(schema.auditEvents).set({ payload: null })
    .where(and(isNull(schema.auditEvents.ownerId), isNotNull(schema.auditEvents.payload), lt(schema.auditEvents.at, daysAgo(365))));
  r.auditPayloadsExpired = (owned.rowCount ?? 0) + (orphan.rowCount ?? 0);

  // Anchor completed days only (a day's head is final once the day is over).
  await anchorDay(daysAgo(1));
  if (Object.values(r).some((v) => v > 0)) await audit({ type: "retention.applied", payload: r });
  log.info({ retention: r }, "retention run complete");
  return r;
}
export { eq };
