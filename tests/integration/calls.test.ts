import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { redis } from "@/lib/redis";
import { resetAll } from "../helpers";
import { Client } from "../client";
import { owner, mintToken, startGate, emailCaller } from "../flows";
import { resetEnvCache } from "@/lib/env";
import { sweepCalls } from "@/lib/calls";
import * as gateOutcome from "@/app/api/gate/[id]/outcome/route";
import * as callRoute from "@/app/api/calls/[id]/route";
import * as signal from "@/app/api/calls/[id]/signal/route";
import * as incoming from "@/app/api/calls/incoming/route";
import * as ice from "@/app/api/calls/ice/route";
import * as notifications from "@/app/api/notifications/route";
import * as chatMessages from "@/app/api/chats/[id]/messages/route";
import * as chats from "@/app/api/chats/route";

const SDP = (lines: string[]) => ["v=0", "o=- 1 2 IN IP4 0.0.0.0", "s=-", "t=0 0", "m=audio 9 UDP/TLS/RTP/SAVPF 111", ...lines].join("\r\n");
const HOST = "a=candidate:1 1 udp 2122260223 192.168.1.23 54400 typ host generation 0";
const SRFLX = "a=candidate:2 1 udp 1686052607 41.84.10.20 54400 typ srflx raddr 192.168.1.23 rport 54400";
const RELAY = "a=candidate:3 1 udp 41885439 198.51.100.7 49170 typ relay raddr 41.84.10.20 rport 54400";

async function setup(label = "Bicycle") {
  const o = await owner();
  const t = await mintToken(o.c, o.numberId, { tier: 1, label });
  const caller = new Client("Caller/1.0", `10.70.0.${Math.floor(Math.random() * 200)}`);
  const ph = await emailCaller(caller);
  const g = await startGate(caller, t.link);
  return { o, t, caller, ph, requestId: g.body.requestId as string, gate: g.body };
}
async function call(s: Awaited<ReturnType<typeof setup>>) {
  const r = await s.caller.post(gateOutcome.POST, "/x", { choice: "app_call" }, { id: s.requestId });
  expect(r.status).toBe(200);
  expect(r.body.appCallId).toBeTruthy();
  return r.body.appCallId as string;
}
const act = (c: Client, id: string, action: string) => c.post(callRoute.POST, "/x", { action }, { id });

describe("in-app calls over data", () => {
  beforeEach(resetAll);

  it("is the only kind of call offered", async () => {
    const s = await setup();
    expect(s.gate.options).toEqual(["reveal", "chat", "app_call"]);
  });

  it("rings the owner's open app, connects, and records metadata only", async () => {
    const s = await setup();
    // Owner has the app open (incoming poll marks them online)
    expect((await s.o.c.get(incoming.GET, "/x")).body.call).toBeNull();
    const id = await call(s);
    const inc = await s.o.c.get(incoming.GET, "/x");
    expect(inc.body.call).toMatchObject({ id, from: s.ph.handle, label: "Bicycle" });
    expect(JSON.stringify(inc.body)).not.toMatch(/\+268|\d{8}/);

    const asCaller = await s.caller.get(callRoute.GET, "/x", { id });
    expect(asCaller.body).toMatchObject({ status: "ringing", role: "caller", with: s.o.handle, ownerOnline: true });

    // Only the owner can answer, and media setup must wait for the answer.
    expect((await act(s.caller, id, "accept")).body.error).toBe("invalid_action");
    expect((await s.caller.post(signal.POST, "/x", { type: "offer", sdp: SDP([]) }, { id })).body.error).toBe("not_answered");

    expect((await act(s.o.c, id, "accept")).body).toMatchObject({ status: "accepted", role: "owner" });
    const audit = await db().select().from(schema.auditEvents).where(eq(schema.auditEvents.subjectId, id));
    expect(audit.map((a) => a.type)).toEqual(expect.arrayContaining(["call.started", "call.answered"]));

    // Hang up from either side ends it once; repeats are harmless.
    const end = await act(s.caller, id, "hangup");
    expect(end.body).toMatchObject({ status: "ended", endedBy: "caller" });
    expect((await act(s.o.c, id, "hangup")).body.status).toBe("ended");
    const [row] = await db().select().from(schema.appCalls).where(eq(schema.appCalls.id, id));
    expect(Object.keys(row)).not.toContain("sdp");
    expect(JSON.stringify(row)).not.toMatch(/\+268/);
  });

  it("relays signalling once, drops anything that would reveal an IP address, and deletes it after reading", async () => {
    const s = await setup();
    const id = await call(s);
    await act(s.o.c, id, "accept");
    await s.caller.post(signal.POST, "/x", { type: "offer", sdp: SDP([HOST, SRFLX, RELAY]) }, { id });
    const host = await s.caller.post(signal.POST, "/x", { type: "ice", candidate: { candidate: HOST.slice(2), sdpMid: "0", sdpMLineIndex: 0 } }, { id });
    expect(host.body.dropped).toBe(true);
    await s.caller.post(signal.POST, "/x", { type: "ice", candidate: { candidate: RELAY.slice(2), sdpMid: "0", sdpMLineIndex: 0 } }, { id });

    const pulled = await s.o.c.get(signal.GET, "/x", { id });
    expect(pulled.body.signals.map((x: any) => x.type)).toEqual(["offer", "ice"]);
    const offer = pulled.body.signals[0].sdp as string;
    expect(offer).toContain("typ relay");
    expect(offer).not.toContain("192.168.1.23 54400 typ host");
    expect(offer).not.toContain("typ srflx");
    expect((await s.o.c.get(signal.GET, "/x", { id })).body.signals).toEqual([]);   // read once
    expect(pulled.body.call.status).toBe("accepted");

    // A stranger can't read or write this call.
    const stranger = new Client(); await emailCaller(stranger);
    expect((await stranger.get(signal.GET, "/x", { id })).status).toBe(404);
    expect((await act(stranger, id, "hangup")).status).toBe(404);

    await act(s.o.c, id, "hangup");
    expect(await redis().keys(`call:sig:${id}:*`)).toEqual([]);
  });

  it("turns an unanswered ring into a missed call the owner can answer in chat", async () => {
    const s = await setup("Car sale");
    const id = await call(s);
    await db().update(schema.appCalls).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(schema.appCalls.id, id));
    expect(await sweepCalls(true)).toBe(1);
    expect((await s.caller.get(callRoute.GET, "/x", { id })).body).toMatchObject({ status: "missed" });

    const n = (await s.o.c.get(notifications.GET, "/x")).body.notifications;
    const missed = n.find((x: any) => x.kind === "missed_call");
    expect(missed.title).toBe(`Missed call from @${s.ph.handle} about "Car sale"`);
    expect(missed.link).toMatch(/^\/chats\/[0-9a-f-]{36}$/);
    expect(n.find((x: any) => x.kind === "new_chat")).toBeUndefined();   // the chat was opened quietly

    const convId = missed.link.split("/").pop();
    const timeline = await s.o.c.get(chatMessages.GET, "/x", { id: convId });
    expect(timeline.body.calls).toEqual([expect.objectContaining({ id, status: "missed" })]);
    expect((await s.o.c.get(chats.GET, "/x")).body.conversations).toHaveLength(1);
  });

  it("lets the owner decline, and the caller cancel (a missed call if the owner wasn't looking)", async () => {
    const s = await setup();
    const id1 = await call(s);
    expect((await act(s.o.c, id1, "decline")).body).toMatchObject({ status: "declined", endedBy: "owner" });
    const id2 = await call(s);
    expect((await act(s.caller, id2, "hangup")).body.status).toBe("cancelled");
    const kinds = (await s.o.c.get(notifications.GET, "/x")).body.notifications.map((x: any) => x.kind);
    expect(kinds).toContain("missed_call");
  });

  it("reports busy when the owner is already on a call, and allows one call at a time per person", async () => {
    const s = await setup();
    const id = await call(s);
    expect((await s.caller.post(gateOutcome.POST, "/x", { choice: "app_call" }, { id: s.requestId })).body.error).toBe("already_in_call");

    const other = new Client("Other/1.0", "10.71.0.9");
    await emailCaller(other);
    const t2 = await mintToken(s.o.c, s.o.numberId, { label: "Second" });
    const g = await startGate(other, t2.link);
    const r = await other.post(gateOutcome.POST, "/x", { choice: "app_call" }, { id: g.body.requestId });
    expect((await other.get(callRoute.GET, "/x", { id: r.body.appCallId })).body.status).toBe("busy");
    void id;
  });

  it("ends a call when one side disappears (closed tab, lost signal)", async () => {
    const s = await setup();
    const id = await call(s);
    await act(s.o.c, id, "accept");
    await s.caller.get(signal.GET, "/x", { id });        // caller heartbeat only; owner went silent
    await db().update(schema.appCalls).set({ answeredAt: new Date(Date.now() - 40_000) }).where(eq(schema.appCalls.id, id));
    const v = (await s.caller.get(callRoute.GET, "/x", { id })).body;
    expect(v).toMatchObject({ status: "ended", endedBy: "system" });
    expect(v.durationSec).toBeGreaterThanOrEqual(39);
  });

  it("issues short-lived TURN credentials coturn can verify, without revealing who the user is", async () => {
    const s = await setup();
    const r = await s.caller.get(ice.GET, "/x");
    expect(r.body.iceTransportPolicy).toBe("relay");
    const [srv] = r.body.iceServers;
    expect(srv.urls).toEqual(["turn:turn.test:3478?transport=udp"]);
    const [exp, tag] = srv.username.split(":");
    expect(Number(exp) * 1000).toBeGreaterThan(Date.now());
    expect(Number(exp) * 1000).toBeLessThan(Date.now() + 2 * 3600_000);
    expect(tag).toMatch(/^[0-9a-f]{12}$/);
    expect(srv.username).not.toContain(s.ph.handle);
    const expected = crypto.createHmac("sha1", process.env.TURN_SECRET!).update(srv.username).digest("base64");
    expect(srv.credential).toBe(expected);
    expect((await new Client().get(ice.GET, "/x")).status).toBe(401);
  });

  it("offers the caller an in-app call from the chat; the owner can't start one", async () => {
    const s = await setup();
    const out = await s.caller.post(gateOutcome.POST, "/x", { choice: "chat" }, { id: s.requestId });
    const convId = out.body.conversationId;
    expect((await s.caller.get(chatMessages.GET, "/x", { id: convId })).body.call).toMatchObject({ canStart: true, appCall: true, requestId: s.requestId });
    expect((await s.o.c.get(chatMessages.GET, "/x", { id: convId })).body.call).toMatchObject({ canStart: false, reason: "owner" });
  });

  it("requires a real TURN relay in production", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { APP_ENV: "production", CAPTCHA_PROVIDER: "turnstile", SMS_PROVIDER: "africastalking", 
      EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_1234567890abc", EMAIL_FROM: "PryingEyes <no-reply@example.com>", APP_URL: "https://example.com",
      TURN_URLS: "turn:localhost:3478", CALL_RELAY_ONLY: "false" });
    resetEnvCache();
    const { env } = await import("@/lib/env");
    try {
      expect(() => env()).toThrow(/TURN_URLS must point at your public TURN server/);
      expect(() => env()).toThrow(/CALL_RELAY_ONLY must be true/);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved); resetEnvCache();
    }
    void and;
  });
});
