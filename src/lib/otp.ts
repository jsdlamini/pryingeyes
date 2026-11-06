/** One-time passcodes: 6 digits, 10-minute life, 5 attempts, stored as keyed hashes. */
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { hmacHex, randomDigits, timingSafeEqualHex } from "./crypto";
import { secretsHmacKey } from "./keys";
import { authBudgets } from "./ratelimit";
import { sendEmail } from "./providers";
import { HttpError, tooMany } from "./errors";
import { log } from "./log";

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const codeHash = (purpose: string, subject: string, code: string) => hmacHex(secretsHmacKey(), `otp:${purpose}:${subject}:${code}`);

/** Codes are sent by email only (PryingEyes sends no text messages). */
export type OtpDestination = { channel: "email"; email: string };

export async function issueOtp(o: { userId?: string | null; purpose: string; subject: string; dest: OtpDestination; message: (code: string) => string }) {
  const budget = await authBudgets.otpSend(`${o.purpose}:${o.subject}`);
  if (!budget.allowed) throw tooMany(budget.retryAfter, "Too many codes requested. Please wait and try again.");
  const code = randomDigits(6);
  await db().insert(schema.otpChallenges).values({
    userId: o.userId ?? null, purpose: o.purpose, subject: o.subject, codeHash: codeHash(o.purpose, o.subject, code),
    channel: o.dest.channel, expiresAt: new Date(Date.now() + TTL_MS),
  });
  try {
    await sendEmail({ userId: o.userId, to: o.dest.email, subject: "Your PryingEyes code", text: o.message(code), tag: "one_time_code" });
  } catch (err) {
    log.warn({ err, channel: o.dest.channel }, "one-time code delivery failed");
    throw new HttpError(503, "delivery_failed", "We couldn't send your code just now. Please try again shortly.");
  }
  return { channel: o.dest.channel };
}

/** Verifies the most recent live code for (purpose, subject). */
export async function verifyOtp(purpose: string, subject: string, code: string, opts: { consume?: boolean } = {}): Promise<"ok" | "wrong" | "expired"> {
  const rows = await db().select().from(schema.otpChallenges)
    .where(and(eq(schema.otpChallenges.purpose, purpose), eq(schema.otpChallenges.subject, subject),
      isNull(schema.otpChallenges.verifiedAt), gt(schema.otpChallenges.expiresAt, new Date())))
    .orderBy(desc(schema.otpChallenges.createdAt)).limit(1);
  const c = rows[0];
  if (!c || c.attempts >= MAX_ATTEMPTS) return "expired";
  await db().update(schema.otpChallenges).set({ attempts: c.attempts + 1 }).where(eq(schema.otpChallenges.id, c.id));
  const ok = /^\d{6}$/.test(code) && timingSafeEqualHex(c.codeHash, codeHash(purpose, subject, code));
  if (!ok) return "wrong";
  if (opts.consume === false) return "ok";
  await db().update(schema.otpChallenges).set({ verifiedAt: new Date() }).where(eq(schema.otpChallenges.id, c.id));
  return "ok";
}
