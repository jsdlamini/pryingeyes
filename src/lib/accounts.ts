/** Account lifecycle: sign-up, verification, sign-in, MFA, recovery (rules 1 and 2). */
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { randomCrockford, hmacHex, randomId, sha256Hex, groupCode, normaliseCrockford } from "./crypto";
import { secretsHmacKey } from "./keys";
import { env } from "./env";
import { grantConfiguredAdmins } from "./bootstrap-admins";
import { HttpError, badRequest, conflict, forbidden, tooMany, unauthorized } from "./errors";
import { issueOtp, verifyOtp } from "./otp";
import { burnPasswordTime, checkPasswordPolicy, hashPassword, verifyPassword } from "./password";
import { authBudgets } from "./ratelimit";
import { sendEmail } from "./providers";
import { blindIndex, decryptForUser, encryptForUser } from "./vault";
import { newTotpSecret, otpauthUri, verifyTotp } from "./totp";
import { notify } from "./notify";
import { hasMfa } from "./auth";
import { handleTakenError, isHandleConflict, isHandleTaken, parseChosenHandle, suggestHandle } from "./handles";
import { redis } from "./redis";
import { log } from "./log";

export const handleSchema = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_.]{2,23}$/, "3–24 characters: letters, numbers, underscore or dot.");
export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/**
 * Resolves the handle for a new account: the person's choice if given (must be free), otherwise
 * a generated one. `insert` runs with the handle; if a concurrent sign-up grabs a generated
 * handle first, a new one is generated and the insert retried.
 */
async function withHandle<T>(chosen: string | undefined | null, insert: (handle: string) => Promise<T>): Promise<T> {
  const wanted = await parseChosenHandle(chosen);
  if (wanted && (await isHandleTaken(wanted))) throw await handleTakenError();
  for (let attempt = 0; attempt < 5; attempt++) {
    const handle = wanted ?? (await suggestHandle());
    try {
      return await insert(handle);
    } catch (e) {
      if (!isHandleConflict(e)) throw e;
      if (wanted) throw await handleTakenError();
    }
  }
  throw new Error("could not allocate a handle");
}

// ---- email sign-up --------------------------------------------------------
/** Where to send someone after they confirm their email: only a local path, never another site. */
export function safeNext(next?: string | null): string | null {
  return next && /^\/(?!\/)[\w\-./?=&%]*$/.test(next) && next.length <= 200 ? next : null;
}

export async function signupEmail(input: { email: string; password: string; handle?: string | null; ageConfirmed: boolean; next?: string | null }, ip: string) {
  const b = await authBudgets.signupIp(ip);
  if (!b.allowed) throw tooMany(b.retryAfter);
  if (!input.ageConfirmed) throw badRequest("age_required", "PryingEyes is for people aged 18 or over.");
  checkPasswordPolicy(input.password);
  const email = emailSchema.parse(input.email);
  await parseChosenHandle(input.handle); // fail fast, before hashing the password
  const existing = await db().select().from(schema.users).where(eq(schema.users.email, email));
  const ex = existing[0];
  if (ex && ex.status === "pending" && !ex.emailVerifiedAt) {
    // A sign-up that was never confirmed (e.g. the email didn't arrive). It can't sign in and
    // holds no data, so the latest attempt replaces it; its old links stop working.
    await db().delete(schema.users).where(eq(schema.users.id, ex.id));
  } else if (ex) {
    // Do not reveal registration status. Tell the real owner instead.
    await sendEmail({ userId: ex.id, to: email, subject: "Someone tried to sign up with your email", tag: "security",
      text: "Someone tried to create a PryingEyes account with this email address. If it was you, sign in instead. If not, you can ignore this email." })
      .catch((err) => log.warn({ err }, "sign-up notice email failed"));
    return { status: "check_email" as const };
  }
  const passwordHash = await hashPassword(input.password);
  const u = await withHandle(input.handle, async (handle) =>
    (await db().insert(schema.users).values({ handle, email, passwordHash, ageConfirmedAt: new Date(), status: "pending" }).returning())[0]);
  await audit({ type: "account.created", actorId: u.id, ownerId: u.id, payload: { method: "email" } });
  try {
    await sendVerificationEmail(u.id, email, input.next);
  } catch (err) {
    log.warn({ err }, "verification email failed");
    throw new HttpError(503, "email_unavailable", "We couldn't send the confirmation email just now. Please try again in a minute.");
  }
  return { status: "check_email" as const };
}

export async function sendVerificationEmail(userId: string, email: string, next?: string | null) {
  const secret = randomId(32);
  await db().insert(schema.verificationTokens).values({
    hash: sha256Hex(secret), userId, purpose: "verify_email", expiresAt: new Date(Date.now() + 24 * 3600_000),
  });
  await sendEmail({ userId, to: email, subject: "Confirm your PryingEyes email", tag: "verification",
    text: `Confirm your email to finish creating your account:\n\n${env().APP_URL}/verify-email?token=${secret}${safeNext(next) ? `&next=${encodeURIComponent(safeNext(next)!)}` : ""}\n\nThis link expires in 24 hours.` });
}

export async function verifyEmailToken(secret: string) {
  const [t] = await db().select().from(schema.verificationTokens).where(eq(schema.verificationTokens.hash, sha256Hex(secret ?? "")));
  if (!t || t.usedAt || t.expiresAt < new Date() || t.purpose !== "verify_email") throw badRequest("link_invalid", "This link has expired or was already used.");
  await db().transaction(async (tx) => {
    await tx.update(schema.verificationTokens).set({ usedAt: new Date() }).where(eq(schema.verificationTokens.hash, t.hash));
    await tx.update(schema.users).set({ emailVerifiedAt: new Date(), status: "active" })
      .where(and(eq(schema.users.id, t.userId), sql`${schema.users.status} <> 'suspended'`));
    await audit({ type: "account.verified", actorId: t.userId, ownerId: t.userId, payload: { channel: "email" } }, tx);
  });
  await grantConfiguredAdmins(t.userId);
  return t.userId;
}

// ---- password sign-in -------------------------------------------------------
export async function passwordLogin(input: { email: string; password: string }, ip: string) {
  const email = (input.email ?? "").trim().toLowerCase();
  const [a, b] = await Promise.all([authBudgets.loginIp(ip), authBudgets.loginId(email)]);
  if (!a.allowed || !b.allowed) throw tooMany(Math.max(a.retryAfter, b.retryAfter));
  const [u] = email ? await db().select().from(schema.users).where(eq(schema.users.email, email)) : [];
  if (!u || !u.passwordHash) {
    await burnPasswordTime(input.password ?? "");
    throw unauthorized("login_failed", "That email and password don't match.");
  }
  if (!(await verifyPassword(u.passwordHash, input.password ?? ""))) {
    await audit({ type: "account.login_failed", actorId: u.id, ownerId: u.id, payload: { method: "password" } });
    throw unauthorized("login_failed", "That email and password don't match.");
  }
  if (u.status === "suspended") throw forbidden("account_suspended", "This account is suspended.");
  if (u.status === "pending") throw forbidden("verification_required", "Confirm your email first — check your inbox for the link.");
  return { userId: u.id, mfaRequired: await hasMfa(u.id) };
}

// ---- TOTP -----------------------------------------------------------------
export async function totpBegin(userId: string, handle: string) {
  const secret = newTotpSecret();
  const enc = await encryptForUser(userId, secret, `totp:${userId}`);
  await db().insert(schema.totpSecrets).values({ userId, secretEnc: enc })
    .onConflictDoUpdate({ target: schema.totpSecrets.userId, set: { secretEnc: enc, confirmedAt: null, createdAt: new Date() },
      setWhere: isNull(schema.totpSecrets.confirmedAt) });
  const [row] = await db().select().from(schema.totpSecrets).where(eq(schema.totpSecrets.userId, userId));
  if (row.confirmedAt) throw conflict("totp_exists", "An authenticator app is already set up.");
  return { secret, uri: otpauthUri(secret, `@${handle}`) };
}

async function checkTotp(userId: string, code: string): Promise<boolean> {
  const b = await authBudgets.mfa(userId);
  if (!b.allowed) throw tooMany(b.retryAfter);
  const [row] = await db().select().from(schema.totpSecrets).where(eq(schema.totpSecrets.userId, userId));
  const [u] = await db().select().from(schema.users).where(eq(schema.users.id, userId));
  if (!row || !u) return false;
  const secret = await decryptForUser(userId, row.secretEnc, `totp:${userId}`);
  const step = verifyTotp(secret, (code ?? "").replace(/\s/g, ""), u.totpLastStep ?? null);
  if (step === null) return false;
  // Compare-and-set so a code can't be replayed concurrently.
  const upd = await db().update(schema.users).set({ totpLastStep: step })
    .where(and(eq(schema.users.id, userId), sql`coalesce(${schema.users.totpLastStep}, -1) < ${step}`));
  return (upd.rowCount ?? 0) === 1;
}

export async function totpConfirm(userId: string, code: string) {
  const [row] = await db().select().from(schema.totpSecrets).where(eq(schema.totpSecrets.userId, userId));
  if (!row) throw badRequest("totp_not_started", "Start authenticator setup first.");
  if (!(await checkTotp(userId, code))) throw badRequest("code_invalid", "That code didn't match. Check your phone's clock and try again.");
  const first = !(await hasMfa(userId));
  await db().update(schema.totpSecrets).set({ confirmedAt: new Date() }).where(eq(schema.totpSecrets.userId, userId));
  await audit({ type: "account.mfa_enrolled", actorId: userId, ownerId: userId, payload: { factor: "totp" } });
  return { recoveryCodes: first ? await generateRecoveryCodes(userId) : null };
}

export async function totpVerify(userId: string, code: string) {
  const [row] = await db().select().from(schema.totpSecrets).where(eq(schema.totpSecrets.userId, userId));
  if (!row?.confirmedAt) throw badRequest("totp_not_enrolled", "No authenticator app is set up.");
  if (!(await checkTotp(userId, code))) throw badRequest("code_invalid", "That code didn't match.");
}

// ---- recovery codes ---------------------------------------------------------
const rcHash = (userId: string, code: string) => hmacHex(secretsHmacKey(), `rc:${userId}:${normaliseCrockford(code)}`);

export async function generateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: 10 }, () => groupCode(randomCrockford(10), 5));
  await db().transaction(async (tx) => {
    await tx.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, userId));
    await tx.insert(schema.recoveryCodes).values(codes.map((c) => ({ userId, codeHash: rcHash(userId, c) })));
  });
  return codes;
}

async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const b = await authBudgets.mfa(userId);
  if (!b.allowed) throw tooMany(b.retryAfter);
  const r = await db().update(schema.recoveryCodes).set({ usedAt: new Date() })
    .where(and(eq(schema.recoveryCodes.userId, userId), eq(schema.recoveryCodes.codeHash, rcHash(userId, code ?? "")), isNull(schema.recoveryCodes.usedAt)));
  return (r.rowCount ?? 0) === 1;
}

/** Lost second factor: a recovery code starts a 24-hour cooldown and alerts every device. */
export async function recoveryStart(userId: string, code: string) {
  if (!(await consumeRecoveryCode(userId, code))) throw badRequest("code_invalid", "That recovery code isn't valid.");
  const open = await db().select().from(schema.accountRecoveries)
    .where(and(eq(schema.accountRecoveries.userId, userId), isNull(schema.accountRecoveries.completedAt), isNull(schema.accountRecoveries.cancelledAt)));
  const availableAt = open[0]?.availableAt ?? new Date(Date.now() + 24 * 3600_000);
  if (!open[0]) await db().insert(schema.accountRecoveries).values({ userId, availableAt });
  await audit({ type: "account.recovery_started", actorId: userId, ownerId: userId });
  await notify(userId, { kind: "recovery", title: "Account recovery started",
    body: "Someone used a recovery code to reset two-step sign-in on your account. It completes in 24 hours. If this wasn't you, cancel it from Settings now.",
    link: "/settings", email: true });
  return { availableAt };
}

export async function recoveryComplete(userId: string) {
  const [r] = await db().select().from(schema.accountRecoveries)
    .where(and(eq(schema.accountRecoveries.userId, userId), isNull(schema.accountRecoveries.completedAt), isNull(schema.accountRecoveries.cancelledAt)));
  if (!r) throw badRequest("no_recovery", "There's no recovery in progress.");
  if (r.availableAt > new Date()) throw forbidden("recovery_cooldown", `Recovery completes after ${r.availableAt.toISOString()}.`);
  await db().transaction(async (tx) => {
    await tx.update(schema.accountRecoveries).set({ completedAt: new Date() }).where(eq(schema.accountRecoveries.id, r.id));
    await tx.delete(schema.totpSecrets).where(eq(schema.totpSecrets.userId, userId));
    await tx.delete(schema.passkeys).where(eq(schema.passkeys.userId, userId));
    await tx.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, userId));
    await audit({ type: "account.recovery_completed", actorId: userId, ownerId: userId }, tx);
  });
  await notify(userId, { kind: "recovery", title: "Two-step sign-in was reset", body: "Set up a passkey or authenticator app again to keep protecting your numbers.", link: "/onboarding" });
}

export async function recoveryCancel(userId: string) {
  const r = await db().update(schema.accountRecoveries).set({ cancelledAt: new Date() })
    .where(and(eq(schema.accountRecoveries.userId, userId), isNull(schema.accountRecoveries.completedAt), isNull(schema.accountRecoveries.cancelledAt)));
  if ((r.rowCount ?? 0) > 0) await audit({ type: "account.recovery_cancelled", actorId: userId, ownerId: userId });
  return (r.rowCount ?? 0) > 0;
}

export async function changePassword(userId: string, newPassword: string) {
  checkPasswordPolicy(newPassword);
  await db().update(schema.users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(schema.users.id, userId));
  await audit({ type: "account.password_changed", actorId: userId, ownerId: userId });
}

export async function accountSummary(userId: string) {
  const [u] = await db().select().from(schema.users).where(eq(schema.users.id, userId));
  const pk = await db().select({ id: schema.passkeys.id, name: schema.passkeys.name, createdAt: schema.passkeys.createdAt, lastUsedAt: schema.passkeys.lastUsedAt })
    .from(schema.passkeys).where(eq(schema.passkeys.userId, userId));
  const [totp] = await db().select({ confirmedAt: schema.totpSecrets.confirmedAt }).from(schema.totpSecrets).where(eq(schema.totpSecrets.userId, userId));
  const rc = await db().select({ usedAt: schema.recoveryCodes.usedAt }).from(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, userId));
  const [rec] = await db().select().from(schema.accountRecoveries)
    .where(and(eq(schema.accountRecoveries.userId, userId), isNull(schema.accountRecoveries.completedAt), isNull(schema.accountRecoveries.cancelledAt)));
  return {
    id: u.id, handle: u.handle, email: u.email, emailVerified: !!u.emailVerifiedAt, status: u.status, roles: u.roles,
    hasPassword: !!u.passwordHash, totp: !!totp?.confirmedAt, passkeys: pk,
    recoveryCodesLeft: rc.filter((r) => !r.usedAt).length,
    recovery: rec ? { availableAt: rec.availableAt } : null,
    auditRetentionMonths: u.auditRetentionMonths, readReceipts: u.readReceipts, panicAt: u.panicAt,
  };
}
