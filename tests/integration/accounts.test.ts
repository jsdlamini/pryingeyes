import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { resetAll, syntheticNumber } from "../helpers";
import { Client, lastOutbox, codeIn, maskedTo, totpNow } from "../client";
import { emailCaller, emailOwner, enrolTotp, mintToken, owner, startGate } from "../flows";
import * as gateOtp from "@/app/api/gate/[id]/otp/route";
import * as signup from "@/app/api/auth/signup/route";
import * as verifyEmail from "@/app/api/auth/verify-email/route";
import * as login from "@/app/api/auth/login/route";
import * as logout from "@/app/api/auth/logout/route";
import * as mfaTotp from "@/app/api/auth/mfa/totp/route";
import * as totpSetup from "@/app/api/auth/totp/setup/route";
import * as totpConfirm from "@/app/api/auth/totp/confirm/route";
import * as recStart from "@/app/api/auth/recovery/start/route";
import * as recComplete from "@/app/api/auth/recovery/complete/route";
import * as recCancel from "@/app/api/auth/recovery/cancel/route";
import * as sessions from "@/app/api/auth/sessions/route";
import * as sessionDel from "@/app/api/auth/sessions/[id]/route";
import * as me from "@/app/api/me/route";
import * as password from "@/app/api/auth/password/route";

describe("email sign-up, verification and password sign-in", () => {
  beforeEach(resetAll);

  it("requires 18+ and a strong password", async () => {
    const c = new Client();
    expect((await c.post(signup.POST, "/x", { email: "a@b.test", password: "correct horse battery", handle: "abc", ageConfirmed: false })).body.error).toBe("age_required");
    expect((await c.post(signup.POST, "/x", { email: "a@b.test", password: "short", handle: "abc", ageConfirmed: true })).body.error).toBe("weak_password");
  });

  it("does not reveal whether an email is registered", async () => {
    const c = new Client();
    const { email } = await emailOwner(c);
    const again = await new Client().post(signup.POST, "/x", { email, password: "another good password", handle: "someoneelse", ageConfirmed: true });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("check_email");
    expect((await lastOutbox({ channel: "email", to: email })).subject).toMatch(/tried to sign up/);
  });

  it("blocks sign-in until the email is verified, and verification links are single-use", async () => {
    const c = new Client();
    const email = "pending@example.test";
    await c.post(signup.POST, "/x", { email, password: "correct horse battery", handle: "pendinguser", ageConfirmed: true });
    expect((await c.post(login.POST, "/x", { email, password: "correct horse battery" })).body.error).toBe("verification_required");
    const token = (await lastOutbox({ channel: "email", to: email })).body.match(/token=([\w-]+)/)![1];
    expect((await c.post(verifyEmail.POST, "/x", { token })).status).toBe(200);
    expect((await c.post(verifyEmail.POST, "/x", { token })).body.error).toBe("link_invalid");
  });

  it("uses one generic error for wrong password and unknown account", async () => {
    const c = new Client();
    const { email } = await emailOwner(c);
    const a = await new Client().post(login.POST, "/x", { email, password: "wrong password here" });
    const b = await new Client().post(login.POST, "/x", { email: "nobody@example.test", password: "wrong password here" });
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it("rate-limits password guessing", async () => {
    const c = new Client();
    const { email } = await emailOwner(c);
    const attacker = new Client(undefined, "10.9.9.9");
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await attacker.post(login.POST, "/x", { email, password: `guess-number-${i}` })).status;
    expect(last).toBe(429);
  });

  it("rejects cross-site requests", async () => {
    const c = new Client();
    const r = await c.call(login.POST, "POST", "/x", { email: "a@b.test", password: "x" }, {}, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("bad_origin");
  });
});

describe("TOTP enrolment, MFA sign-in and replay protection", () => {
  beforeEach(resetAll);

  it("enrols, issues recovery codes, and requires the second factor at next sign-in", async () => {
    const c = new Client();
    const { email, pw } = await emailOwner(c);
    const { secret, recoveryCodes } = await enrolTotp(c);
    expect(recoveryCodes).toHaveLength(10);
    expect((await c.get(me.GET, "/api/me")).body.owner).toMatchObject({ mfa: true, sessionMfa: true });

    await c.post(logout.POST, "/x");
    const r = await c.post(login.POST, "/x", { email, password: pw });
    expect(r.body.status).toBe("mfa_required");
    // An MFA-pending session cannot reach protected endpoints
    expect((await c.get(sessions.GET, "/x")).body.error).toBe("mfa_required");
    // Same code as during enrolment is a replay (same time step) → rejected
    expect((await c.post(mfaTotp.POST, "/x", { code: totpNow(secret) })).body.error).toBe("code_invalid");
    expect((await c.post(mfaTotp.POST, "/x", { code: totpNow(secret, 30_000) })).status).toBe(200);
    expect((await c.get(sessions.GET, "/x")).status).toBe(200);
  });
});

describe("email only: no text messages", () => {
  beforeEach(resetAll);

  it("keeps the code or invite someone was opening through sign-up, and only allows local paths", async () => {
    const c = new Client();
    await c.post(signup.POST, "/x", { email: "next@example.test", password: "correct horse battery", ageConfirmed: true, next: "/t/ABCD-EFGH-JKMN-PQRS" });
    expect((await lastOutbox({ channel: "email", to: "next@example.test" })).body).toMatch(/verify-email\?token=[\w-]+&next=%2Ft%2FABCD-EFGH-JKMN-PQRS/);
    await c.post(signup.POST, "/x", { email: "evil@example.test", password: "correct horse battery", ageConfirmed: true, next: "//evil.example/t/x" });
    expect((await lastOutbox({ channel: "email", to: "evil@example.test" })).body).not.toContain("next=");
  });

  it("never sends a text message, even for security alerts", async () => {
    const o = await owner();
    const t = await mintToken(o.c, o.numberId, { tier: 2 });
    const caller = new Client("Caller/1.0", "10.70.1.1");
    const { email } = await emailCaller(caller);
    const g = await startGate(caller, t.link);
    await caller.post(gateOtp.POST, "/x", { action: "send" }, { id: g.body.requestId });
    expect(codeIn((await lastOutbox({ channel: "email", to: email })).body)).toMatch(/^\d{6}$/);
    for (let i = 0; i < 6; i++) await caller.post(gateOtp.POST, "/x", { action: "verify", code: "000000" }, { id: g.body.requestId });
    const sms = await db().select().from(schema.devOutbox).where(eq(schema.devOutbox.channel, "sms"));
    expect(sms).toEqual([]);
  });
});

describe("sessions", () => {
  beforeEach(resetAll);

  it("are bound to the device and expire when idle", async () => {
    const c = new Client();
    await emailOwner(c);
    const stolen = new Client("Different Browser/1.0");
    stolen.cookie = c.cookie;
    expect((await stolen.get(me.GET, "/x")).status).toBe(401);
    await db().update(schema.sessions).set({ lastSeenAt: new Date(Date.now() - 13 * 3600_000) });
    expect((await c.get(me.GET, "/x")).status).toBe(401);
  });

  it("can be listed and revoked remotely", async () => {
    const a = new Client(), b = new Client("Mozilla/5.0 (Android) Chrome/130.0");
    const { email, pw } = await emailOwner(a);
    await b.post(login.POST, "/x", { email, password: pw });
    const list = await a.get(sessions.GET, "/x");
    expect(list.body.sessions).toHaveLength(2);
    const other = list.body.sessions.find((s: any) => !s.current);
    expect(other.deviceLabel).toBe("Chrome on Android");
    await a.del(sessionDel.DELETE, "/x", { id: other.id });
    expect((await b.get(me.GET, "/x")).status).toBe(401);
    expect((await a.get(me.GET, "/x")).status).toBe(200);
  });

  it("password change signs out other devices", async () => {
    const a = new Client(), b = new Client("Other/2.0");
    const { email, pw } = await emailOwner(a);
    await b.post(login.POST, "/x", { email, password: pw });
    expect((await a.post(password.POST, "/x", { current: pw, password: "a brand new passphrase" })).status).toBe(200);
    expect((await b.get(me.GET, "/x")).status).toBe(401);
  });
});

describe("account recovery with a 24-hour cooldown", () => {
  beforeEach(resetAll);

  it("starts with a recovery code, notifies, enforces cooldown, and can be cancelled", async () => {
    const c = new Client();
    const { email, pw } = await emailOwner(c);
    const { recoveryCodes } = await enrolTotp(c);
    const other = new Client("Phone/1.0");
    await other.post(login.POST, "/x", { email, password: pw }); // mfa pending session on another device
    await c.post(logout.POST, "/x");

    const lost = new Client("Lost/1.0");
    await lost.post(login.POST, "/x", { email, password: pw });
    expect((await lost.post(recStart.POST, "/x", { code: "WRONG-CODE0" })).body.error).toBe("code_invalid");
    const s = await lost.post(recStart.POST, "/x", { code: recoveryCodes[0].toLowerCase() });
    expect(s.status).toBe(200);
    expect(new Date(s.body.availableAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect((await lastOutbox({ channel: "email", to: email })).subject).toMatch(/recovery started/i);
    // a used code can't be reused
    expect((await lost.post(recStart.POST, "/x", { code: recoveryCodes[0] })).body.error).toBe("code_invalid");

    expect((await lost.post(recComplete.POST, "/x")).body.error).toBe("recovery_cooldown");
    await db().update(schema.accountRecoveries).set({ availableAt: new Date(Date.now() - 1000) });
    expect((await lost.post(recComplete.POST, "/x")).status).toBe(200);
    const m = await lost.get(me.GET, "/x");
    expect(m.body.user.totp).toBe(false);
    expect(m.body.owner.mfa).toBe(false);
  });

  it("can be cancelled from a signed-in device", async () => {
    const c = new Client();
    const { email, pw } = await emailOwner(c);
    const { recoveryCodes, secret } = await enrolTotp(c);
    const lost = new Client("Lost/1.0");
    await lost.post(login.POST, "/x", { email, password: pw });
    await lost.post(recStart.POST, "/x", { code: recoveryCodes[1] });
    expect((await c.post(recCancel.POST, "/x")).body.cancelled).toBe(true);
    expect((await lost.post(recComplete.POST, "/x")).body.error).toBe("no_recovery");
    void secret;
    const [u] = await db().select().from(schema.users).where(eq(schema.users.email, email));
    expect(u).toBeTruthy();
  });
});
