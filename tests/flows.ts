import { expect } from "vitest";
import { Client, lastOutbox, codeIn, totpNow } from "./client";
import * as signup from "@/app/api/auth/signup/route";
import * as verifyEmail from "@/app/api/auth/verify-email/route";
import * as login from "@/app/api/auth/login/route";
import * as totpSetup from "@/app/api/auth/totp/setup/route";
import * as totpConfirm from "@/app/api/auth/totp/confirm/route";
import { syntheticNumber } from "./helpers";

export async function emailOwner(c: Client, email = `o${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`, handle?: string) {
  handle ??= `u${Math.random().toString(36).slice(2, 10)}`;
  const pw = "correct horse battery";
  expect((await c.post(signup.POST, "/api/auth/signup", { email, password: pw, handle, ageConfirmed: true })).status).toBe(200);
  const mail = await lastOutbox({ channel: "email", to: email });
  const token = mail.body.match(/token=([\w-]+)/)![1];
  expect((await c.post(verifyEmail.POST, "/api/auth/verify-email", { token })).status).toBe(200);
  expect((await c.post(login.POST, "/api/auth/login", { email, password: pw })).body.status).toBe("signed_in");
  return { email, pw, handle };
}

export async function enrolTotp(c: Client) {
  const s = await c.post(totpSetup.POST, "/api/auth/totp/setup");
  expect(s.status).toBe(200);
  const r = await c.post(totpConfirm.POST, "/api/auth/totp/confirm", { code: totpNow(s.body.secret) });
  expect(r.status).toBe(200);
  return { secret: s.body.secret as string, recoveryCodes: r.body.recoveryCodes as string[] };
}


/** A plain account (verified email, no two-step sign-in), as most callers and group members have. */
export async function emailCaller(c: Client, handle = `c${Math.random().toString(36).slice(2, 10)}`) {
  const acct = await emailOwner(c, undefined, handle);
  return { email: acct.email, handle };
}

/** The 6-digit code most recently emailed to this address (sign-in checks and Tier 2/3 gate codes). */
export async function emailedCode(email: string) {
  return codeIn((await lastOutbox({ channel: "email", to: email })).body);
}

import * as numbers from "@/app/api/numbers/route";
import * as tokensRoute from "@/app/api/tokens/route";
import * as gateStart from "@/app/api/gate/start/route";
import { DEV_CAPTCHA_TOKEN } from "@/lib/captcha";

/** A fully set-up owner: verified email, TOTP enrolled, one protected number. */
export async function owner(c: Client = new Client()) {
  const acct = await emailOwner(c);
  const mfa = await enrolTotp(c);
  const phone = syntheticNumber();
  const n = await c.post(numbers.POST, "/x", { phone, label: "Personal mobile" });
  expect(n.status).toBe(201);
  return { c, ...acct, ...mfa, phone, numberId: n.body.id as string };
}

export async function mintToken(c: Client, numberId: string, opts: { tier?: number; class?: string; label?: string; ttlHours?: number | null; decodeBudget?: number | null } = {}) {
  const r = await c.post(tokensRoute.POST, "/x", { numberId, tier: opts.tier ?? 1, class: opts.class ?? "standard", label: opts.label ?? "Test token",
    ttlHours: opts.ttlHours, decodeBudget: opts.decodeBudget });
  expect(r.status).toBe(201);
  return r.body as { token: { id: string }; link: string; short: string };
}

export const startGate = (c: Client, code: string, captcha: string | null = DEV_CAPTCHA_TOKEN) =>
  c.post(gateStart.POST, "/api/gate/start", { code, captcha });
