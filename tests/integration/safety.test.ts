import { describe, it, expect, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { resetAll } from "../helpers";
import { Client, lastOutbox, totpNow } from "../client";
import { owner, mintToken, startGate, emailCaller } from "../flows";
import * as gateOutcome from "@/app/api/gate/[id]/outcome/route";
import * as chats from "@/app/api/chats/route";
import * as chatMessages from "@/app/api/chats/[id]/messages/route";
import * as chatBlock from "@/app/api/chats/[id]/block/route";
import * as reports from "@/app/api/reports/route";
import * as moderation from "@/app/api/moderation/route";
import * as moderate from "@/app/api/moderation/[id]/route";
import * as adminActions from "@/app/api/admin/actions/route";
import * as adminDecide from "@/app/api/admin/actions/[id]/route";
import * as auditRoute from "@/app/api/audit/route";
import * as auditExport from "@/app/api/audit/export/route";
import * as evidenceVerify from "@/app/api/evidence/verify/route";
import * as dashboard from "@/app/api/dashboard/route";
import * as meExport from "@/app/api/me/export/route";
import * as meErase from "@/app/api/me/erase/route";
import * as me from "@/app/api/me/route";
import * as mfaTotp from "@/app/api/auth/mfa/totp/route";
import { runRetention } from "@/lib/retention";
import { verifyChain } from "@/lib/audit";
import { verifyEvidence } from "@/lib/evidence";
import { resetEnvCache } from "@/lib/env";

async function chatPair(tier = 1) {
  const o = await owner();
  const t = await mintToken(o.c, o.numberId, { tier, label: "Car sale" });
  const caller = new Client("Caller/1.0", `10.50.0.${Math.floor(Math.random() * 200)}`);
  const ph = await emailCaller(caller);
  let g = await startGate(caller, t.link);
  if (tier >= 2) {
    const otp = await import("@/app/api/gate/[id]/otp/route");
    const { lastOutbox: lo, codeIn } = await import("../client");
    await caller.post(otp.POST, "/x", { action: "send" }, { id: g.body.requestId });
    g = await caller.post(otp.POST, "/x", { action: "verify", code: codeIn((await lo({ channel: "email", to: ph.email })).body) }, { id: g.body.requestId });
  }
  const out = await caller.post(gateOutcome.POST, "/x", { choice: "chat" }, { id: g.body.requestId });
  return { o, caller, convId: out.body.conversationId as string, t, ph };
}

describe("chat", () => {
  beforeEach(resetAll);

  it("lets both sides talk without exchanging numbers; content is encrypted at rest", async () => {
    const { o, caller, convId } = await chatPair();
    await caller.post(chatMessages.POST, "/x", { text: "Hi! Is the car still for sale?" }, { id: convId });
    await o.c.post(chatMessages.POST, "/x", { text: "Yes, come Saturday." }, { id: convId });
    const ownerView = await o.c.get(chatMessages.GET, "/x", { id: convId });
    expect(ownerView.body.messages.map((m: any) => m.text)).toEqual(["Hi! Is the car still for sale?", "Yes, come Saturday."]);
    expect(ownerView.body.conversation.role).toBe("owner");
    const dump = JSON.stringify((await db().execute(sql`SELECT encode(ciphertext,'escape') c FROM messages`)).rows);
    expect(dump).not.toContain("still for sale");
    const list = await caller.get(chats.GET, "/x");
    expect(list.body.conversations[0]).toMatchObject({ label: "Car sale", role: "caller", unread: 1 }); // the owner's reply
    // Outsiders can't read it
    const outsider = new Client("Out/1.0", "10.51.0.1");
    await emailCaller(outsider);
    expect((await outsider.get(chatMessages.GET, "/x", { id: convId })).status).toBe(404);
  });

  it("makes Tier 3 messages disappear after 24 hours", async () => {
    const o = await owner();
    const t = await mintToken(o.c, o.numberId, { tier: 3, label: "Dating" });
    const caller = new Client("Caller/1.0", "10.52.0.1");
    const { email } = await emailCaller(caller);
    const { lastOutbox: lo, codeIn } = await import("../client");
    const otp = await import("@/app/api/gate/[id]/otp/route");
    const consent = await import("@/app/api/gate/[id]/consent/route");
    const decision = await import("@/app/api/requests/[id]/decision/route");
    const g = await startGate(caller, t.link);
    await caller.post(otp.POST, "/x", { action: "send" }, { id: g.body.requestId });
    await caller.post(otp.POST, "/x", { action: "verify", code: codeIn((await lo({ channel: "email", to: email })).body) }, { id: g.body.requestId });
    await caller.post(consent.POST, "/x", {}, { id: g.body.requestId });
    await o.c.post(decision.POST, "/x", { decision: "approve_relay" }, { id: g.body.requestId });
    const out = await caller.post(gateOutcome.POST, "/x", { choice: "chat" }, { id: g.body.requestId });
    await caller.post(chatMessages.POST, "/x", { text: "hello" }, { id: out.body.conversationId });
    const [m] = await db().select().from(schema.messages);
    expect(m.expiresAt!.getTime() - m.createdAt.getTime()).toBe(24 * 3600_000);
    await db().update(schema.messages).set({ expiresAt: new Date(Date.now() - 1) });
    expect((await o.c.get(chatMessages.GET, "/x", { id: out.body.conversationId })).body.messages).toHaveLength(0);
    expect((await runRetention()).messagesPurged).toBe(1);
  });

  it("block stops messages both ways; report attaches only chosen messages", async () => {
    const { o, caller, convId } = await chatPair();
    await caller.post(chatMessages.POST, "/x", { text: "first" }, { id: convId });
    const bad = await caller.post(chatMessages.POST, "/x", { text: "a threatening message" }, { id: convId });
    const r = await o.c.post(reports.POST, "/x", { conversationId: convId, reason: "threats", details: "Scary", messageIds: [bad.body.id], block: true });
    expect(r.status).toBe(201);
    expect((await caller.post(chatMessages.POST, "/x", { text: "again" }, { id: convId })).body.error).toBe("blocked");
    expect((await o.c.post(chatMessages.POST, "/x", { text: "x" }, { id: convId })).body.error).toBe("blocked");
    const [rep] = await db().select().from(schema.reports);
    expect(rep.detailsEnc!.toString("latin1")).not.toContain("threatening");
  });

  it("rejects empty and over-long messages and rate-limits floods", async () => {
    const { caller, convId } = await chatPair();
    expect((await caller.post(chatMessages.POST, "/x", { text: "   " }, { id: convId })).body.error).toBe("empty");
    expect((await caller.post(chatMessages.POST, "/x", { text: "x".repeat(2001) }, { id: convId })).body.error).toBe("too_long");
    let last = 0;
    for (let i = 0; i < 32; i++) last = (await caller.post(chatMessages.POST, "/x", { text: `m${i}` }, { id: convId })).status;
    expect(last).toBe(429);
  });
});

describe("moderation and break-glass administration", () => {
  beforeEach(resetAll);

  async function staff(role: "moderator" | "admin", ip: string) {
    const s = await owner(new Client(`${role}/1.0`, ip));
    await db().update(schema.users).set({ roles: [role] }).where(eq(schema.users.email, s.email));
    return s;
  }

  it("moderators see the report and attached messages, never numbers, and can suspend", async () => {
    const { o, caller, convId, ph } = await chatPair();
    const m = await caller.post(chatMessages.POST, "/x", { text: "send me money now" }, { id: convId });
    await o.c.post(reports.POST, "/x", { conversationId: convId, reason: "scam", details: "asked for money", messageIds: [m.body.id] });
    expect((await o.c.get(moderation.GET, "/x")).status).toBe(403);
    const mod = await staff("moderator", "10.60.0.1");
    const q = await mod.c.get(moderation.GET, "/x");
    expect(q.body.reports).toHaveLength(1);
    const rep = q.body.reports[0];
    expect(rep).toMatchObject({ reason: "scam", reported: ph.handle, slaBreached: false });
    expect(rep.details.messages[0].text).toBe("send me money now");
    expect(JSON.stringify(q.body)).not.toContain(ph.email);
    expect(JSON.stringify(q.body)).not.toContain(o.phone.slice(4));
    await mod.c.post(moderate.POST, "/x", { action: "suspend", note: "scam" }, { id: rep.id });
    expect((await caller.get(me.GET, "/x")).status).toBe(401); // suspended users are signed out
    expect((await mod.c.post(moderate.POST, "/x", { action: "dismiss" }, { id: rep.id })).body.error).toBe("already_handled");
  });

  it("flags reports older than one hour without a response", async () => {
    const { o, convId } = await chatPair();
    await o.c.post(reports.POST, "/x", { conversationId: convId, reason: "spam" });
    await db().update(schema.reports).set({ createdAt: new Date(Date.now() - 61 * 60_000) });
    const mod = await staff("moderator", "10.60.0.2");
    expect((await mod.c.get(moderation.GET, "/x")).body.reports[0].slaBreached).toBe(true);
  });

  it("admin actions need two different administrators", async () => {
    const a1 = await staff("admin", "10.61.0.1"), a2 = await staff("admin", "10.61.0.2");
    const target = new Client("T/1.0", "10.61.0.3");
    const { handle } = await emailCaller(target);
    const r = await a1.c.post(adminActions.POST, "/x", { request: { action: "suspend_user", handle }, reason: "Repeated harassment reports" });
    expect(r.status).toBe(201);
    expect((await a1.c.post(adminDecide.POST, "/x", { approve: true }, { id: r.body.id })).body.error).toBe("dual_control");
    const ok = await a2.c.post(adminDecide.POST, "/x", { approve: true }, { id: r.body.id });
    expect(ok.body).toMatchObject({ status: "executed" });
    expect((await target.get(me.GET, "/x")).status).toBe(401);
    const types = (await db().select().from(schema.auditEvents)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["admin.requested", "admin.approved", "admin.executed", "account.suspended"]));
  });

  it("admin requests require a recent second factor", async () => {
    const a1 = await staff("admin", "10.62.0.1");
    await db().update(schema.sessions).set({ mfaAt: new Date(Date.now() - 3600_000) });
    expect((await a1.c.post(adminActions.POST, "/x", { request: { action: "rewrap_keys" }, reason: "Quarterly key rotation" })).body.error).toBe("step_up_required");
    await a1.c.post(mfaTotp.POST, "/x", { code: totpNow(a1.secret, 30_000) });
    expect((await a1.c.post(adminActions.POST, "/x", { request: { action: "rewrap_keys" }, reason: "Quarterly key rotation" })).status).toBe(201);
  });
});

describe("audit feed, dashboard and evidence packs", () => {
  beforeEach(resetAll);

  it("shows the owner who did what, without numbers, and exports a verifiable signed pack", async () => {
    const { o, caller } = await chatPair();
    void caller;
    const d = await o.c.get(dashboard.GET, "/x");
    expect(d.body.stats).toMatchObject({ activeTokens: 1, contactsThisWeek: 1 });
    expect(d.body.feed.map((f: any) => f.type)).toEqual(expect.arrayContaining(["gate.passed", "chat.opened", "token.created"]));
    expect(JSON.stringify(d.body)).not.toContain(o.phone.slice(4));
    const feed = await o.c.get(auditRoute.GET, "/x");
    const passed = feed.body.events.find((e: any) => e.type === "gate.passed");
    expect(passed).toMatchObject({ token: "Car sale" });
    expect(passed.actor).toBeTruthy();

    const ev = await o.c.get(auditExport.GET, "/api/audit/export?format=json");
    expect(ev.body.signature).toBeTruthy();
    expect(verifyEvidence(ev.body)).toBe(true);
    expect((await new Client().post(evidenceVerify.POST, "/x", ev.body)).body).toEqual({ valid: true, signedByThisServer: true });
    const tampered = { ...ev.body, events: ev.body.events.slice(1) };
    expect((await new Client().post(evidenceVerify.POST, "/x", tampered)).body.valid).toBe(false);
    const pdf = await o.c.get(auditExport.GET, "/api/audit/export?format=pdf");
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    expect((pdf.body as Buffer).toString("latin1")).not.toContain(o.phone.slice(4));
  });
});

describe("data export and erasure", () => {
  beforeEach(resetAll);

  it("exports the user's own data, including their numbers, behind a fresh second factor", async () => {
    const o = await owner();
    await mintToken(o.c, o.numberId, { label: "Exported" });
    const ex = await o.c.get(meExport.GET, "/x");
    expect(ex.status).toBe(200);
    expect(ex.body.numbers[0].number).toBe(o.phone);
    expect(ex.body.tokens[0].label).toBe("Exported");
    await db().update(schema.sessions).set({ mfaAt: new Date(Date.now() - 3600_000) });
    expect((await o.c.get(meExport.GET, "/x")).body.error).toBe("step_up_required");
  });

  it("erases the account and its keys while keeping the audit chain verifiable", async () => {
    const { o, caller, convId } = await chatPair();
    await caller.post(chatMessages.POST, "/x", { text: "bye" }, { id: convId });
    const [u] = await db().select().from(schema.users).where(eq(schema.users.email, o.email));
    expect((await o.c.post(meErase.POST, "/x", { confirm: "nope" })).status).toBe(400);
    expect((await o.c.post(meErase.POST, "/x", { confirm: "DELETE MY ACCOUNT" })).body.status).toBe("erased");
    for (const t of ["users", "user_keys", "phone_numbers", "tokens", "conversations", "messages"] as const) {
      const n = (await db().execute(sql.raw(`SELECT count(*)::int n FROM ${t} WHERE ${t === "users" ? "id" : t === "tokens" ? "owner_id" : t === "conversations" ? "owner_id" : t === "messages" ? "conversation_id" : "user_id"} = '${t === "messages" ? convId : u.id}'`))).rows[0] as { n: number };
      expect(n.n, t).toBe(0);
    }
    const withPayload = await db().select().from(schema.auditEvents).where(sql`(owner_id = ${u.id} OR actor_id = ${u.id}) AND payload IS NOT NULL`);
    expect(withPayload).toHaveLength(0);
    expect((await verifyChain()).ok).toBe(true);
    expect((await o.c.get(me.GET, "/x")).status).toBe(401);
  });
});

describe("retention jobs", () => {
  beforeEach(resetAll);

  it("expires tokens, purges old OTPs, applies audit retention and anchors the day", async () => {
    const o = await owner();
    const t = await mintToken(o.c, o.numberId, { class: "expiring", ttlHours: 1 });
    // A Tier 2 gate code creates a one-time-code record.
    const t2 = await mintToken(o.c, o.numberId, { tier: 2, label: "Codes" });
    const cc = new Client("C/1.0", "10.70.0.1");
    await emailCaller(cc);
    const g2 = await startGate(cc, t2.link);
    await cc.post((await import("@/app/api/gate/[id]/otp/route")).POST, "/x", { action: "send" }, { id: g2.body.requestId });
    await db().update(schema.tokens).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(schema.tokens.id, t.token.id));
    await db().update(schema.otpChallenges).set({ createdAt: new Date(Date.now() - 91 * 86400_000) });
    await db().execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_guard_trg`);
    await db().execute(sql`UPDATE audit_events SET at = at - interval '13 months' WHERE type = 'token.created'`);
    await db().execute(sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_guard_trg`);
    const r = await runRetention();
    expect(r.tokensExpired).toBe(1);
    expect(r.otpPurged).toBeGreaterThan(0);
    expect(r.auditPayloadsExpired).toBeGreaterThan(0);
    const anchors = await db().select().from(schema.auditAnchors);
    expect(anchors.length).toBeGreaterThan(0);
  });
});

describe("configuration safety", () => {
  it("refuses development providers in production", async () => {
    const saved = { ...process.env };
    process.env.APP_ENV = "production"; resetEnvCache();
    const { env } = await import("@/lib/env");
    expect(() => env()).toThrow(/CAPTCHA_PROVIDER=dev is not allowed/);
    process.env.APP_ENV = "staging"; resetEnvCache();
    expect(() => env()).toThrow(/APP_ENV=staging/);
    delete process.env.APP_ENV; Object.assign(process.env, saved); resetEnvCache();
  });
});
