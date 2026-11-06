import { describe, it, expect, beforeEach } from "vitest";
import { resetAll } from "../helpers";
import { Client } from "../client";
import { owner, emailCaller, startGate } from "../flows";
import * as tokensRoute from "@/app/api/tokens/route";
import * as tokenRoute from "@/app/api/tokens/[id]/route";
import * as outcome from "@/app/api/gate/[id]/outcome/route";
import * as consent from "@/app/api/gate/[id]/consent/route";
import * as requests from "@/app/api/requests/route";
import * as decision from "@/app/api/requests/[id]/decision/route";
import * as dashboard from "@/app/api/dashboard/route";
import * as me from "@/app/api/me/route";
import * as groups from "@/app/api/groups/route";
import * as join from "@/app/api/groups/join/route";
import * as gposts from "@/app/api/groups/[id]/posts/route";

const ip = () => `10.90.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
async function person() { const c = new Client("Person/1.0", ip()); const p = await emailCaller(c); return { c, ...p }; }
const mint = (c: Client, body: Record<string, unknown>) =>
  c.post(tokensRoute.POST, "/x", { tier: 1, class: "standard", label: "Bread orders", ...body });

describe("app-only codes (no phone number behind them)", () => {
  beforeEach(resetAll);

  it("anyone signed up by phone can create one straight away: no number, no two-step sign-in", async () => {
    const o = await person();
    expect((await o.c.get(me.GET, "/x")).body.numbers).toBe(0);
    const r = await mint(o.c, {});
    expect(r.status).toBe(201);
    expect(r.body.token.appOnly).toBe(true);
    expect(r.body.short).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    const list = await o.c.get(tokensRoute.GET, "/x");
    expect(list.body.tokens[0]).toMatchObject({ appOnly: true, number: null, label: "Bread orders" });
    expect((await o.c.get(dashboard.GET, "/x")).status).toBe(200);
  });

  it("callers get only a message or an in-app call; showing or ringing a number is refused", async () => {
    const o = await person();
    const t = await mint(o.c, {});
    const caller = await person();
    const g = await startGate(caller.c, t.body.link);
    expect(g.body.options).toEqual(["chat", "app_call"]);
    expect((await caller.c.post(outcome.POST, "/x", { choice: "reveal" }, { id: g.body.requestId })).status).toBe(409);
    const chat = await caller.c.post(outcome.POST, "/x", { choice: "chat" }, { id: g.body.requestId });
    expect(chat.body.conversationId).toBeTruthy();
    const call = await caller.c.post(outcome.POST, "/x", { choice: "app_call" }, { id: g.body.requestId });
    expect(call.body.appCallId).toBeTruthy();
  });

  it("Tier 3: the owner approves without two-step sign-in, and 'reveal once' becomes a plain approval", async () => {
    const o = await person();
    const t = await mint(o.c, { tier: 3, class: "expiring", label: "Room to rent" });
    const caller = await person();
    const g = await startGate(caller.c, t.body.link);
    expect(g.body.step).toBe("otp");
    // Tier 3: the caller confirms an SMS code, then asks the owner.
    const { lastOutbox, codeIn, maskedTo } = await import("../client");
    const otpRoute = await import("@/app/api/gate/[id]/otp/route");
    await caller.c.post(otpRoute.POST, "/x", { action: "send" }, { id: g.body.requestId });
    const code = codeIn((await lastOutbox({ channel: "email", to: caller.email })).body);
    await caller.c.post(otpRoute.POST, "/x", { action: "verify", code }, { id: g.body.requestId });
    await caller.c.post(consent.POST, "/x", { note: "Hi, is the room free?" }, { id: g.body.requestId });

    const reqs = await o.c.get(requests.GET, "/x");
    expect(reqs.body.requests[0]).toMatchObject({ stage: "consent_pending", appOnly: true });
    const d = await o.c.post(decision.POST, "/x", { decision: "reveal_once" }, { id: g.body.requestId });
    expect(d.status).toBe(200);
    const after = await (await import("@/app/api/gate/[id]/route")).GET;
    expect((await caller.c.get(after, "/x", { id: g.body.requestId })).body.options).toEqual(["chat", "app_call"]);
    const view = await caller.c.post(outcome.POST, "/x", { choice: "chat" }, { id: g.body.requestId });
    expect(view.body.conversationId).toBeTruthy();
  });

  it("a code backed by a phone number still needs two-step sign-in", async () => {
    const o = await owner(new Client("Owner/1.0", ip()));      // has a number and two-step sign-in
    const p = await person();
    const r = await mint(p.c, { numberId: o.numberId });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("owner_setup_required");
    // The full owner can still make both kinds.
    expect((await mint(o.c, { numberId: o.numberId })).body.token.appOnly).toBe(false);
    expect((await mint(o.c, {})).body.token.appOnly).toBe(true);
  });

  it("pausing and revoking work without two-step sign-in", async () => {
    const o = await person();
    const t = await mint(o.c, {});
    expect((await o.c.post(tokenRoute.POST, "/x", { action: "pause" }, { id: t.body.token.id })).status).toBe(200);
    expect((await o.c.post(tokenRoute.POST, "/x", { action: "resume" }, { id: t.body.token.id })).status).toBe(200);
    expect((await o.c.post(tokenRoute.POST, "/x", { action: "revoke" }, { id: t.body.token.id })).status).toBe(200);
  });

  it("in groups, anyone can attach a contact code; it reaches them in the app only", async () => {
    const a = await person();
    const g = await a.c.post(groups.POST, "/x", { name: "Mbabane Runners" });
    const b = await person();
    await b.c.post(join.POST, "/x", { invite: g.body.invite });
    const bId = (await b.c.get(me.GET, "/x")).body.user.id;
    await a.c.post((await import("@/app/api/groups/[id]/requests/route")).POST, "/x", { userId: bId, decision: "approve" }, { id: g.body.id });
    const p = await a.c.post(gposts.POST, "/x", { text: "Pacing group on Saturday, message me", attach: { tier: 1 } }, { id: g.body.id });
    expect(p.status).toBe(201);
    const [post] = (await b.c.get(gposts.GET, "/x", { id: g.body.id })).body.posts;
    expect(post.code).toMatchObject({ live: true, tier: 1 });
    const gate = await startGate(b.c, post.code.link);
    expect(gate.body).toMatchObject({ label: "Group: Mbabane Runners", options: ["chat", "app_call"] });
  });
});
