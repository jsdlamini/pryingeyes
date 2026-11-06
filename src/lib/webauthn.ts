import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON, type AuthenticatorTransport,
} from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "./env";
import { redis } from "./redis";
import { randomId } from "./crypto";
import { badRequest } from "./errors";

const CHALLENGE_TTL = 300;
const origin = () => new URL(env().APP_URL).origin;

export async function registrationOptions(user: { id: string; handle: string }) {
  const existing = await db().select().from(schema.passkeys).where(eq(schema.passkeys.userId, user.id));
  const opts = await generateRegistrationOptions({
    rpName: env().RP_NAME, rpID: env().RP_ID,
    userName: user.handle, userID: new TextEncoder().encode(user.id), userDisplayName: `@${user.handle}`,
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports as AuthenticatorTransport[] })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  await redis().set(`webauthn:reg:${user.id}`, opts.challenge, "EX", CHALLENGE_TTL);
  return opts;
}

export async function verifyRegistration(userId: string, response: RegistrationResponseJSON, name?: string) {
  const challenge = await redis().getdel(`webauthn:reg:${userId}`);
  if (!challenge) throw badRequest("challenge_expired", "That took too long. Please try again.");
  const v = await verifyRegistrationResponse({
    response, expectedChallenge: challenge, expectedOrigin: origin(), expectedRPID: env().RP_ID, requireUserVerification: true,
  }).catch(() => null);
  if (!v?.verified || !v.registrationInfo) throw badRequest("passkey_failed", "We couldn't verify that passkey.");
  const c = v.registrationInfo.credential;
  await db().insert(schema.passkeys).values({
    id: c.id, userId, publicKey: Buffer.from(c.publicKey), counter: c.counter,
    transports: (c.transports ?? []) as string[], name: (name || "Passkey").slice(0, 40),
  });
  return c.id;
}

/** Starts an authentication ceremony. With a userId, only that user's credentials are allowed. */
export async function authenticationOptions(userId?: string) {
  const allow = userId ? await db().select().from(schema.passkeys).where(eq(schema.passkeys.userId, userId)) : [];
  const opts = await generateAuthenticationOptions({
    rpID: env().RP_ID, userVerification: "required",
    allowCredentials: allow.map((p) => ({ id: p.id, transports: p.transports as AuthenticatorTransport[] })),
  });
  const ceremonyId = randomId(18);
  await redis().set(`webauthn:auth:${ceremonyId}`, JSON.stringify({ challenge: opts.challenge, userId: userId ?? null }), "EX", CHALLENGE_TTL);
  return { ceremonyId, options: opts };
}

/** Returns the authenticated user id, or throws. */
export async function verifyAuthentication(ceremonyId: string, response: AuthenticationResponseJSON): Promise<string> {
  const raw = await redis().getdel(`webauthn:auth:${ceremonyId}`);
  if (!raw) throw badRequest("challenge_expired", "That took too long. Please try again.");
  const { challenge, userId } = JSON.parse(raw) as { challenge: string; userId: string | null };
  const [pk] = await db().select().from(schema.passkeys).where(eq(schema.passkeys.id, response.id));
  if (!pk || (userId && pk.userId !== userId)) throw badRequest("passkey_failed", "That passkey isn't registered here.");
  const v = await verifyAuthenticationResponse({
    response, expectedChallenge: challenge, expectedOrigin: origin(), expectedRPID: env().RP_ID, requireUserVerification: true,
    credential: { id: pk.id, publicKey: new Uint8Array(pk.publicKey), counter: pk.counter, transports: pk.transports as AuthenticatorTransport[] },
  }).catch(() => null);
  if (!v?.verified) throw badRequest("passkey_failed", "We couldn't verify that passkey.");
  await db().update(schema.passkeys).set({ counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(schema.passkeys.id, pk.id));
  return pk.userId;
}
