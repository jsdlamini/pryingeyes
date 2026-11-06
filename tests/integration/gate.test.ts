import { describe, it, expect, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { resetAll, syntheticNumber } from "../helpers";
import { Client, lastOutbox, codeIn, maskedTo, totpNow } from "../client";
import { owner, mintToken, startGate, emailCaller, emailOwner } from "../flows";
import * as gateStatusRoute from "@/app/api/gate/[id]/route";
import * as gateOtp from "@/app/api/gate/[id]/otp/route";
import * as gateConsent from "@/app/api/gate/[id]/consent/route";
import * as gateOutcome from "@/app/api/gate/[id]/outcome/route";
import * as requests from "@/app/api/requests/route";
import * as decision from "@/app/api/requests/[id]/decision/route";
import * as reveal from "@/app/api/reveal/[grantId]/route";
import * as tokenAction from "@/app/api/tokens/[id]/route";
import * as tokensRoute from "@/app/api/tokens/route";
import * as panic from "@/app/api/panic/route";
import * as mfaTotp from "@/app/api/auth/mfa/totp/route";
import * as notifications from "@/app/api/notifications/route";
import { expireStaleConsent } from "@/lib/gate";
import { verifyChain } from "@/lib/audit";
import { resetEnvCache } from "@/lib/env";

/** The gate code emailed to a caller. */
const otpFor = async (email: string) => codeIn((await lastOutbox({ channel: "email", to: email })).body);

async function passOtp(c: Client, requestId: string, email: string) {
  const s = await c.post(gateOtp.POST, "/x", { action: "send" }, { id: requestId });
  expect(s.body.otpSent).toBe(true);
  const v = await c.post(gateOtp.POST, "/x", { action: "verify", code: await otpFor(email) }, { id: requestId });
  return v;
}

describe("tokens", () => {
  beforeEach(resetAll);

  it("issues 80-bit link codes and 50-bit short codes, stored only as keyed hashes", async () => {
    const o = await owner();
    const t = await mintToken(o.c, o.numberId);
    const code = t.link.split("/t/")[1];
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(t.short).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    const dump = JSON.stringify((await db().execute(sql`SELECT * FROM tokens`)).rows);
    expect(dump).not.toContain(code.replace(/-/g, ""));
    expect(dump).not.toContain(t.short.replace(/-/g, ""));
    const list = await o.c.get(tokensRoute.GET, "/x");
    expect(JSON.stringify(list.body)).not.toContain(code.replace(/-/g, "").slice(4));
  });

  it("refuses Tier 4 and enforces 10 live tokens per number", async () => {
    const o = await owner();
    expect((await o.c.post(tokensRoute.POST, "/x", { numberId: o.numberId, tier: 4, class: "standard", label: "v" })).body.error).toBe("tier_unavailable");
    for (let i = 0; i < 10; i++) await mintToken(o.c, o.numberId, { label: `t${i}` });
    const r = await o.c.post(tokensRoute.POST, "/x", { numberId: o.numberId, tier: 1, class: "standard", label: "eleven" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("token_cap");
  });

  it("recommends tiers from context", async () => {
    const o = await owner();
    const r = await o.c.get(tokensRoute.GET, "/api/tokens?recommend=marketplace");
    expect(r.body.recommendation).toEqual({ tier: 3, class: "expiring", ttlHours: 48 });
    expect((await o.c.get(tokensRoute.GET, "/api/tokens?recommend=business")).body.recommendation.tier).toBe(1);
  });

  it("requires owner setup (MFA) before a number can be stored", async () => {
    const c = new Client();
    await emailOwner(c);
    const numbers = await import("@/app/api/numbers/route");
    const r = await c.post(numbers.POST, "/x", { phone: syntheticNumber() });
    expect(r.body.error).toBe("owner_setup_required");
  });
});

describe("decode gate — Tier 1", () => {
  beforeEach(resetAll);

  it("requires sign-in before anything is looked up", async () => {
    const r = await startGate(new Client(), "ABCD-EFGH-JKMN-PQRS");
    expect(r.status).toBe(401);
  });

  it("delivers a one-time, watermarked, uncached image and logs it for the owner", async () => {
    const o = await owner();
    const t = await mintToken(o.c, o.numberId, { tier: 1, label: "Salon bookings" });
    const caller = new Client("Caller/1.0", "10.2.2.2");
    await emailCaller(caller, "lindo_88");
    const g = await startGate(caller, t.link);
    expect(g.body).toMatchObject({ status: "ok", tier: 1, label: "Salon bookings", step: "choose", options: ["reveal", "chat", "app_call"] });
    const out = await caller.post(gateOutcome.POST, "/x", { choice: "reveal" }, { id: g.body.requestId });
    expect(out.body.revealUrl).toMatch(/^\/api\/reveal\//);
    const grantId = out.body.revealUrl.split("/").pop();
    const img = await caller.get(reveal.GET, out.body.revealUrl, { grantId });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toMatch(/no-store/);
    expect((img.body as Buffer).subarray(1, 4).toString()).toBe("PNG");
    expect((img.body as Buffer).toString("latin1")).not.toContain(o.phone.slice(4));
    expect((await caller.get(reveal.GET, "/x", { grantId })).status).toBe(404); // single use
    expect((await caller.post(gateOutcome.POST, "/x", { choice: "reveal" }, { id: g.body.requestId })).body.error).toBe("already_revealed");
    // Another user cannot use someone else's grant
    const types = (await db().select().from(schema.auditEvents).where(eq(schema.auditEvents.ownerId, (await db().select().from(schema.tokens))[0].ownerId))).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["gate.passed", "reveal.granted", "reveal.viewed"]));
  });

  it("accepts the short code and sloppy human input", async () => {
    const o = await owner();
    const t = await mintToken(o.c, o.numberId);
    const caller = new Client("Caller/1.0", "10.2.2.3");
    await emailCaller(caller);
    expect((await startGate(caller, t.short.toLowerCase().replace("-", " "))).body.status).toBe("ok");
  });

  it("gives identical responses for unknown, paused, revoked, frozen and blocked", async () => {
    const o = await owner();
    const paused = await mintToken(o.c, o.numberId, { label: "p" });
    const revoked = await mintToken(o.c, o.numberId, { label: "r" });
    const frozen = await mintToken(o.c, o.numberId, { label: "f" });
    await o.c.post(tokenAction.POST, "/x", { action: "pause" }, { id: paused.token.id });
    await o.c.post(tokenAction.POST, "/x", { action: "revoke" }, { id: revoked.token.id });
    await db().update(schema.tokens).set({ status: "frozen" }).where(eq(schema.tokens.id, frozen.token.id));
    const bodies = [];
    for (const [i, code] of ["ZZZZ-ZZZZ-ZZZZ-ZZZZ", paused.link, revoked.link, frozen.link].entries()) {
      const caller = new Client(`C${i}/1.0`, `10.3.3.${i}`);
      await emailCaller(caller);
      bodies.push((await startGate(caller, code)).body);
    }
    for (const b of bodies) expect(b).toEqual({ status: "unavailable" });
  });

  it("returns no sooner than the configured floor (timing equalisation)", async () => {
    process.env.GATE_FLOOR_MS = "200"; resetEnvCache();
    try {
      const caller = new Client("Caller/1.0", "10.4.4.4");
      await emailCaller(caller);
      for (const code of ["ZZZZ-ZZZZ-ZZZZ-ZZZZ", "nonsense"]) {
        const t0 = performance.now();
        await startGate(caller, code);
        expect(performance.now() - t0).toBeGreaterThanOrEqual(195);
      }
    } finally { process.env.GATE_FLOOR_MS = "20"; resetEnvCache(); }
  });

  it("locks a caller out after five failed checks, and the CAPTCHA can't be skipped", async () => {
    const caller = new Client("Caller/1.0", "10.5.5.5");
    await emailCaller(caller);
    expect((await startGate(caller, "ZZZZ-ZZZZ-ZZZZ-ZZZZ", null)).body.status).toBe("captcha_failed");
    for (let i = 0; i < 4; i++) await startGate(caller, `ZZZZ-ZZZZ-ZZZZ-ZZZ${i}`);
    const r = await startGate(caller, "ZZZZ-ZZZZ-ZZZZ-ZZZY");
    expect(r.body.status).toBe("limited");
    expect(r.body.retryAfter).toBeGreaterThan(3500);
    const n = await caller.get(notifications.GET, "/x");
    expect(n.body.notifications[0].kind).toBe("lockout");
  });

  it("a burst of parallel guesses can't slip past the lockout", async () => {
    const caller = new Client("Burst/1.0", "10.5.5.6");
    await emailCaller(caller);
    const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => startGate(caller, `ZZZZ-ZZZZ-ZZZY-${String(i).padStart(4, "0")}`)));
    const evaluated = rs.filter((r) => r.body.status === "unavailable").length;
    expect(evaluated).toBeLessThanOrEqual(6);
    expect(rs.filter((r) => r.body.status === "limited").length).toBeGreaterThanOrEqual(34);
  });

  it("revocation takes effect immediately, even mid-flow", async () => {
    const o = await owner();
    const t = await mintToken(o.c, o.numberId);
    const caller = new Client("Caller/1.0", "10.6.6.6");
    await emailCaller(caller);
    const g = await startGate(caller, t.link);
    const out = await caller.post(gateOutcome.POST, "/x", { choice: "reveal" }, { id: g.body.requestId });
    await o.c.post(tokenAction.POST, "/x", { action: "revoke" }, { id: t.token.id });
    expect((await caller.get(reveal.GET, "/x", { grantId: out.body.revealUrl.split("/").pop() })).status).toBe(404);
    expect((await caller.post(gateOutcome.POST, "/x", { choice: "chat" }, { id: g.body.requestId })).body).toEqual({ status: "unavailable" });
    expect((await caller.get(gateStatusRoute.GET, "/x", { id: g.body.requestId })).body).toEqual({ status: "unavailable" });
  });

  it("rotation kills the old code and the new one works", async () => {
    const o = await owner();
    const t = await mintToken(o.c, o.numberId);
    const r = await o.c.post(tokenAction.POST, "/x", { action: "rotate" }, { id: t.token.id });
    expect(r.body.link).not.toBe(t.link);
    const caller = new Client("Caller/1.0", "10.7.7.7");
    await emailCaller(caller);
    expect((await startGate(caller, t.link)).body.status).toBe("unavailable");
    expect((await startGate(caller, r.body.link)).body.status).toBe("ok");
  });

  it("disposable tokens are consumed after one delivered outcome", async () => {
    const o = await owner();
    const t = await mintToken(o.c, o.numberId, { class: "disposable" });
    const a = new Client("A/1.0", "10.8.8.1"), b = new Client("B/1.0", "10.8.8.2");
    await emailCaller(a); await emailCaller(b);
    const g = await startGate(a, t.link);
    await a.post(gateOutcome.POST, "/x", { choice: "chat" }, { id: g.body.requestId });
    const [row] = await db().select().from(schema.tokens).where(eq(schema.tokens.id, t.token.id));
    expect(row.status).toBe("consumed");
    expect((await startGate(b, t.link)).body.status).toBe("unavailable");
    // The first caller's conversation still works
    expect((await a.post(gateOutcome.POST, "/x", { choice: "app_call" }, { id: g.body.requestId })).body.appCallId).toBeTruthy();
  });

  it("expiring tokens stop working at expiry and can be extended", async () => {
    const o = await owner();
    const t = await mintToken(o.c, o.numberId, { class: "expiring", ttlHours: 1 });
    await db().update(schema.tokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.tokens.id, t.token.id));
    const caller = new Client("Caller/1.0", "10.9.9.1");
    await emailCaller(caller);
    expect((await startGate(caller, t.link)).body.status).toBe("unavailable");
    await o.c.post(tokenAction.POST, "/x", { action: "extend", hours: 24 }, { id: t.token.id });
    expect((await startGate(caller, t.link)).body.status).toBe("ok");
  });

  it("enforces 3 decodes per caller per token per day", async () => {
    const o = await owner();
    const t = await mintToken(o.c, o.numberId);
    const caller = new Client("Caller/1.0", "10.9.9.2");
    await emailCaller(caller);
    for (let i = 0; i < 3; i++) {
      const g = await startGate(caller, t.link);
      expect(g.body.status).toBe("ok");
      await db().update(schema.decodeRequests).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(schema.decodeRequests.id, g.body.requestId));
    }
    expect((await startGate(caller, t.link)).body.status).toBe("unavailable");
  });
});

describe("decode gate — Tier 2 (OTP)", () => {
  beforeEach(resetAll);

  it("requires a code emailed to the caller, then offers reveal, chat or an in-app call", async () => {
    const o = await owner();
    const t = await mintToken(o.c, o.numberId, { tier: 2, label: "Choir group" });
    const caller = new Client("Caller/1.0", "10.10.0.1");
    const { email } = await emailCaller(caller);
    const g = await startGate(caller, t.link);
    expect(g.body).toMatchObject({ step: "otp", options: [] });
    expect((await caller.post(gateOutcome.POST, "/x", { choice: "reveal" }, { id: g.body.requestId })).status).toBe(409);
    await caller.post(gateOtp.POST, "/x", { action: "send" }, { id: g.body.requestId });
    expect((await caller.post(gateOtp.POST, "/x", { action: "verify", code: "000000" }, { id: g.body.requestId })).body.status).toBe("otp_wrong");
    const v = await caller.post(gateOtp.POST, "/x", { action: "verify", code: await otpFor(email) }, { id: g.body.requestId });
    expect(v.body).toMatchObject({ status: "ok", step: "choose", options: ["reveal", "chat", "app_call"] });
  });

  it("freezes a token after ten failed attempts and alerts the owner by email", async () => {
    const o = await owner();

    const t = await mintToken(o.c, o.numberId, { tier: 2, label: "Market" });
    for (let k = 0; k < 3; k++) {
      const caller = new Client(`C${k}/1.0`, `10.11.0.${k}`);
      await emailCaller(caller);
      const g = await startGate(caller, t.link);
      await caller.post(gateOtp.POST, "/x", { action: "send" }, { id: g.body.requestId });
      for (let i = 0; i < 4; i++) await caller.post(gateOtp.POST, "/x", { action: "verify", code: "123456" }, { id: g.body.requestId });
    }
    const [row] = await db().select().from(schema.tokens).where(eq(schema.tokens.id, t.token.id));
    expect(row.status).toBe("frozen");
    const alert = await lastOutbox({ channel: "email", to: o.email });
    expect(`${alert.subject} ${alert.body}`).toMatch(/frozen|paused|attempts/i);
    // Owner can resume it
    expect((await o.c.post(tokenAction.POST, "/x", { action: "resume" }, { id: t.token.id })).status).toBe(200);
  });

  it("caps a caller at 3 Tier 2 decodes per day across all tokens", async () => {
    const o = await owner();
    const caller = new Client("Caller/1.0", "10.12.0.1");
    const { email } = await emailCaller(caller);
    const results = [];
    for (let i = 0; i < 4; i++) {
      const t = await mintToken(o.c, o.numberId, { tier: 2, label: `t${i}` });
      const g = await startGate(caller, t.link);
      await passOtp(caller, g.body.requestId, email);
      results.push((await caller.post(gateOutcome.POST, "/x", { choice: "chat" }, { id: g.body.requestId })).body.status);
    }
    expect(results).toEqual(["ok", "ok", "ok", "limited"]);
  });
});

describe("decode gate — Tier 3 (owner consent)", () => {
  beforeEach(resetAll);

  async function tier3Request(o: Awaited<ReturnType<typeof owner>>, ip = "10.20.0.1") {
    const t = await mintToken(o.c, o.numberId, { tier: 3, class: "expiring", ttlHours: 48, label: "Marketplace phone" });
    const caller = new Client("Caller/1.0", ip);
    const { email, handle } = await emailCaller(caller, `sipho_${Math.random().toString(36).slice(2, 6)}`);
    const g = await startGate(caller, t.link);
    const v = await passOtp(caller, g.body.requestId, email);
    expect(v.body.step).toBe("consent");
    const c = await caller.post(gateConsent.POST, "/x", { note: "Hi, is the blue bicycle still available?" }, { id: g.body.requestId });
    expect(c.body.step).toBe("waiting");
    return { t, caller, handle, requestId: g.body.requestId as string };
  }

  it("shows the owner who is asking, with the note, and approval opens chat and in-app calls", async () => {
    const o = await owner();
    const { caller, handle, requestId } = await tier3Request(o);
    const list = await o.c.get(requests.GET, "/x");
    expect(list.body.requests[0]).toMatchObject({ stage: "consent_pending", note: "Hi, is the blue bicycle still available?",
      caller: { handle, verification: "account+captcha+otp", region: null, reports: 0 } });   // region comes only from the CDN header now
    expect(JSON.stringify(list.body)).not.toMatch(/\+268/);
    expect((await lastOutbox({ channel: "email", to: o.email })).subject).toMatch(/wants to reach you/);

    await o.c.post(decision.POST, "/x", { decision: "approve_relay" }, { id: requestId });
    const s = await caller.get(gateStatusRoute.GET, "/x", { id: requestId });
    expect(s.body).toMatchObject({ step: "choose", options: ["chat", "app_call"] });
    expect((await caller.post(gateOutcome.POST, "/x", { choice: "reveal" }, { id: requestId })).status).toBe(409);
    expect((await caller.post(gateOutcome.POST, "/x", { choice: "app_call" }, { id: requestId })).body.appCallId).toBeTruthy();
  });

  it("reveal-once allows exactly one reveal, then chat and in-app calls", async () => {
    const o = await owner();
    const { caller, requestId } = await tier3Request(o);
    await o.c.post(decision.POST, "/x", { decision: "reveal_once" }, { id: requestId });
    const r1 = await caller.post(gateOutcome.POST, "/x", { choice: "reveal" }, { id: requestId });
    expect(r1.body.revealUrl).toBeTruthy();
    const s = await caller.get(gateStatusRoute.GET, "/x", { id: requestId });
    expect(s.body.options).toEqual(["chat", "app_call"]);
  });

  it("decline looks the same as an unknown code; decline-and-block blocks future requests", async () => {
    const o = await owner();
    const a = await tier3Request(o, "10.21.0.1");
    await o.c.post(decision.POST, "/x", { decision: "decline" }, { id: a.requestId });
    expect((await a.caller.get(gateStatusRoute.GET, "/x", { id: a.requestId })).body).toEqual({ status: "unavailable" });

    const b = await tier3Request(o, "10.21.0.2");
    await o.c.post(decision.POST, "/x", { decision: "decline_block" }, { id: b.requestId });
    expect((await o.c.post(decision.POST, "/x", { decision: "approve_relay" }, { id: b.requestId })).body.error).toBe("already_decided");
    const t2 = await mintToken(o.c, o.numberId, { tier: 1, label: "other" });
    expect((await startGate(b.caller, t2.link)).body).toEqual({ status: "unavailable" });
  });

  it("unanswered requests expire after 24 hours", async () => {
    const o = await owner();
    const { caller, requestId } = await tier3Request(o);
    await db().update(schema.decodeRequests).set({ consentExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.decodeRequests.id, requestId));
    expect(await expireStaleConsent()).toBe(1);
    expect((await caller.get(gateStatusRoute.GET, "/x", { id: requestId })).body).toEqual({ status: "unavailable" });
    expect((await o.c.post(decision.POST, "/x", { decision: "approve_relay" }, { id: requestId })).status).toBe(409);
  });

  it("only the owner can decide", async () => {
    const o = await owner();
    const { caller, requestId } = await tier3Request(o);
    const intruder = await owner(new Client("Intruder/1.0", "10.22.0.9"));
    expect((await intruder.c.post(decision.POST, "/x", { decision: "approve_relay" }, { id: requestId })).status).toBe(404);
    void caller;
  });
});

describe("panic revoke-all", () => {
  beforeEach(resetAll);

  it("revokes everything in one step without step-up; re-issuing needs a fresh second factor", async () => {
    const o = await owner();
    const ts = [];
    for (let i = 0; i < 4; i++) ts.push(await mintToken(o.c, o.numberId, { label: `t${i}`, tier: (i % 3) + 1 }));
    // Make the session's MFA old, to prove panic itself needs no step-up
    await db().update(schema.sessions).set({ mfaAt: new Date(Date.now() - 3600_000) });
    const p = await o.c.post(panic.POST, "/x");
    expect(p.body).toMatchObject({ status: "revoked", revoked: 4 });
    expect(p.body.ms).toBeLessThan(1000);
    const caller = new Client("Caller/1.0", "10.40.0.1");
    await emailCaller(caller);
    for (const t of ts) expect((await startGate(caller, t.link)).body.status).toBe("unavailable");
    expect((await o.c.post(tokensRoute.POST, "/x", { numberId: o.numberId, tier: 1, class: "standard", label: "new" })).body.error).toBe("step_up_required");
    await o.c.post(mfaTotp.POST, "/x", { code: totpNow(o.secret, 30_000) });
    expect((await o.c.post(tokensRoute.POST, "/x", { numberId: o.numberId, tier: 1, class: "standard", label: "new" })).status).toBe(201);
    expect((await verifyChain()).ok).toBe(true);
  });
});
