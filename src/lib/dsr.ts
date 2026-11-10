/**
 * Data-subject rights (rule 15): self-service export and erasure.
 * Erasure deletes the account and every row it owns (cascade), nulls audit payloads it appears
 * in (the hash chain still verifies), and deletes the user's data key — so any ciphertext that
 * survives in backups becomes unreadable once those backups rotate (crypto-shredding, ≤35 days).
 */
import { and, eq, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit, erasePayloadsFor } from "./audit";
import { decryptForUser, decryptNumberFor, forgetDataKey } from "./vault";
import { listMessages } from "./chat";
import { ownerFeed } from "./feed";
import { deleteUpload, uploadsOf } from "./uploads";

export async function exportData(userId: string) {
  const [u] = await db().select().from(schema.users).where(eq(schema.users.id, userId));
  const numbers = await db().select().from(schema.phoneNumbers).where(eq(schema.phoneNumbers.userId, userId));
  const tokens = await db().select().from(schema.tokens).where(eq(schema.tokens.ownerId, userId));
  const asOwner = await db().select().from(schema.decodeRequests).where(eq(schema.decodeRequests.ownerId, userId));
  const asCaller = await db().select().from(schema.decodeRequests).where(eq(schema.decodeRequests.callerId, userId));
  const convs = await db().select().from(schema.conversations).where(or(eq(schema.conversations.ownerId, userId), eq(schema.conversations.callerId, userId)));
  const notifications = await db().select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
  const sessions = await db().select().from(schema.sessions).where(eq(schema.sessions.userId, userId));
  const out = {
    exportedAt: new Date().toISOString(),
    profile: { handle: u.handle, email: u.email, emailVerifiedAt: u.emailVerifiedAt, phoneVerifiedAt: u.phoneVerifiedAt, createdAt: u.createdAt,
      ageConfirmedAt: u.ageConfirmedAt, roles: u.roles, auditRetentionMonths: u.auditRetentionMonths },
    numbers: await Promise.all(numbers.map(async (n) => ({ kind: n.kind, number: await decryptNumberFor(n.id, "export"), label: n.label, addedAt: n.createdAt }))),
    tokens: tokens.map((t) => ({ label: t.label, class: t.class, tier: t.tier, status: t.status, createdAt: t.createdAt, expiresAt: t.expiresAt, uses: t.uses,
      note: "Codes are not stored, so they can't be exported." })),
    requestsReceived: await Promise.all(asOwner.map(async (r) => ({ id: r.id, tier: r.tier, stage: r.stage, createdAt: r.createdAt, region: r.region,
      note: r.noteEnc ? await decryptForUser(userId, r.noteEnc, `note:${r.id}`) : null }))),
    requestsMade: asCaller.map((r) => ({ id: r.id, tier: r.tier, stage: r.stage, createdAt: r.createdAt, outcome: r.outcome })),
    conversations: await Promise.all(convs.map(async (c) => (await listMessages(userId, c.id)))),
    notifications: notifications.map(({ userId: _u, ...n }) => n),
    sessions: sessions.map((s) => ({ device: s.deviceLabel, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, revokedAt: s.revokedAt })),
    activity: await ownerFeed(userId, { limit: 5000 }),
  };
  await audit({ type: "account.exported", actorId: userId, ownerId: userId });
  return out;
}

export async function eraseAccount(userId: string) {
  // Record the erasure first (opaque ids only), then remove personal data.
  await audit({ type: "account.erased", actorId: userId, ownerId: userId });
  const files = await uploadsOf(userId); // listed now: their records go with the account below
  await db().transaction(async (tx) => {
    // Reports the user filed or received keep their moderation value but lose the link to the person.
    await tx.update(schema.reports).set({ reporterId: null }).where(eq(schema.reports.reporterId, userId));
    await tx.update(schema.reports).set({ reportedUserId: null }).where(eq(schema.reports.reportedUserId, userId));
    await tx.delete(schema.users).where(eq(schema.users.id, userId)); // cascades: keys, numbers, tokens, requests, chats, sessions…
  });
  await erasePayloadsFor(userId);
  await db().delete(schema.devOutbox).where(eq(schema.devOutbox.userId, userId));
  forgetDataKey(userId);
  for (const f of files) await deleteUpload(f);
}

export { and };
