import { describe, it, expect, beforeEach } from "vitest";
import { resetAll, syntheticNumber } from "../helpers";
import { Client, MobileClient, lastOutbox, codeIn, maskedTo, totpNow } from "../client";
import { emailOwner, enrolTotp } from "../flows";
import * as signup from "@/app/api/auth/signup/route";
import * as verifyEmail from "@/app/api/auth/verify-email/route";
import * as login from "@/app/api/auth/login/route";
import * as logout from "@/app/api/auth/logout/route";
import * as me from "@/app/api/me/route";
import * as mfaTotp from "@/app/api/auth/mfa/totp/route";
import * as sessions from "@/app/api/auth/sessions/route";
import * as config from "@/app/api/config/route";
import * as numbers from "@/app/api/numbers/route";

describe("phone app (bearer sessions)", () => {
  beforeEach(resetAll);

  it("signs in with a token in the body, never a cookie, then uses it as a bearer token", async () => {
    const web = new Client();
    const acct = await emailOwner(web);
    const m = new MobileClient();
    const r = await m.post(login.POST, "/x", { email: acct.email, password: acct.pw });
    expect(r.body.status).toBe("signed_in");
    expect(r.body.sessionToken).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    expect(r.headers.get("set-cookie")).toBeNull();
    const who = await m.get(me.GET, "/x");
    expect(who.status).toBe(200);
    expect(who.body.user.handle).toBe(acct.handle);
    const list = await m.get(sessions.GET, "/x");
    expect(list.body.sessions.find((s: any) => s.current).deviceLabel).toBe("PryingEyes app on Android");
  });

  it("completes the authenticator step and owner actions over bearer auth", async () => {
    const web = new Client();
    const acct = await emailOwner(web);
    const { secret } = await enrolTotp(web);
    const m = new MobileClient("PryingEyes-Mobile/1.0 (iOS 19)");
    expect((await m.post(login.POST, "/x", { email: acct.email, password: acct.pw })).body.status).toBe("mfa_required");
    expect((await m.get(numbers.GET, "/x")).status).toBe(401);
    expect((await m.post(mfaTotp.POST, "/x", { code: totpNow(secret, 30_000) })).status).toBe(200);   // the next window: codes are single-use
    const add = await m.post(numbers.POST, "/x", { phone: "7612 3456", country: "SZ", label: "Shop" });
    expect(add.status).toBe(201);
  });

  it("signs up and signs in with email, getting a bearer session", async () => {
    const m = new MobileClient();
    const email = `app_${Date.now()}@example.test`;
    expect((await m.post(signup.POST, "/x", { email, password: "correct horse battery", handle: "app_caller", ageConfirmed: true })).status).toBe(200);
    const token = (await lastOutbox({ channel: "email", to: email })).body.match(/token=([\w-]+)/)![1];
    expect((await m.post(verifyEmail.POST, "/x", { token })).status).toBe(200);
    const v = await m.post(login.POST, "/x", { email, password: "correct horse battery" });
    expect(v.body.status).toBe("signed_in");
    expect(m.token).toBeTruthy();
    expect((await m.get(me.GET, "/x")).body.user.handle).toBe("app_caller");
  });

  it("rejects a stolen token used from a different device, and signs out remotely", async () => {
    const web = new Client();
    const acct = await emailOwner(web);
    const m = new MobileClient();
    await m.post(login.POST, "/x", { email: acct.email, password: acct.pw });
    const thief = new MobileClient("PryingEyes-Mobile/1.0 (iOS 19)");
    thief.token = m.token;
    expect((await thief.get(me.GET, "/x")).status).toBe(401);
    await m.post(logout.POST, "/x");
    expect((await m.get(me.GET, "/x")).status).toBe(401);
  });

  it("still blocks cookie-carrying cross-site requests, even with the app header", async () => {
    const web = new Client();
    const acct = await emailOwner(web);
    const r = await web.call(login.POST, "POST", "/x", { email: acct.email, password: acct.pw }, {}, { origin: "https://evil.example", "x-pe-client": "mobile" });
    expect(r.body.error).toBe("bad_origin");
  });

  it("publishes client settings without secrets", async () => {
    const r = await new MobileClient().get(config.GET, "/x");
    expect(r.body).toMatchObject({ captchaMode: "dev", devTools: true, defaultCountry: "SZ" });
    const text = JSON.stringify(r.body);
    for (const k of ["TURN_SECRET", "TOKEN_PEPPER", "MASTER_KEK", "TURNSTILE_SECRET"]) {
      if (process.env[k]) expect(text).not.toContain(process.env[k]);
    }
  });
});
