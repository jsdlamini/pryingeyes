import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { resetAll, syntheticNumber } from "../helpers";
import { Client, lastOutbox, codeIn, maskedTo } from "../client";
import { owner, mintToken, startGate, emailCaller } from "../flows";
import { normalisePhone } from "@/lib/vault";
import * as numbers from "@/app/api/numbers/route";
import * as gateOutcome from "@/app/api/gate/[id]/outcome/route";
import * as chatMessages from "@/app/api/chats/[id]/messages/route";
import * as notifications from "@/app/api/notifications/route";

describe("country selection for phone numbers", () => {
  beforeEach(resetAll);

  it("normalises a national number with the selected country", () => {
    expect(normalisePhone("7612 3456", "SZ").e164).toBe("+26876123456");
    expect(normalisePhone("082 123 4567", "ZA").e164).toBe("+27821234567");
    expect(normalisePhone("07400 123456", "gb").e164).toBe("+447400123456");
  });

  it("lets a pasted +international number win over the selected country", () => {
    expect(normalisePhone("+27 82 123 4567", "SZ")).toMatchObject({ e164: "+27821234567", country: "ZA" });
    expect(normalisePhone("0027821234567", "SZ").e164).toBe("+27821234567");
  });

  it("names the country when a national number doesn't fit it", () => {
    expect(() => normalisePhone("082 123 4567", "SZ")).toThrow(/Eswatini \(\+268\)/);
  });

  it("rejects unknown countries", () => {
    expect(() => normalisePhone("7612 3456", "XX")).toThrow(/Choose a country/);
  });

  it("adds a protected number from country + national number over the API", async () => {
    const o = await owner();
    const r = await o.c.post(numbers.POST, "/x", { phone: "082 555 0199", country: "ZA", label: "SA mobile" });
    expect(r.status).toBe(201);
    const [row] = await db().select().from(schema.phoneNumbers).where(eq(schema.phoneNumbers.id, r.body.id));
    expect(row.country).toBe("ZA");
    expect(row.hint).toBe("99");
    const bad = await o.c.post(numbers.POST, "/x", { phone: "7612 3456", country: "ZZ" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_country");
    const wrong = await o.c.post(numbers.POST, "/x", { phone: "082 555 0199", country: "SZ" });
    expect(wrong.body.error).toBe("invalid_phone");
    expect(wrong.body.message).toContain("Eswatini");
  });

});

async function chatPair() {
  const o = await owner();
  const t = await mintToken(o.c, o.numberId, { tier: 1, label: "Bicycle" });
  const caller = new Client("Caller/1.0", `10.60.0.${Math.floor(Math.random() * 200)}`);
  const ph = await emailCaller(caller);
  const g = await startGate(caller, t.link);
  const out = await caller.post(gateOutcome.POST, "/x", { choice: "chat" }, { id: g.body.requestId });
  expect(out.body.conversationId).toBeTruthy();
  return { o, caller, ph, t, requestId: g.body.requestId as string, convId: out.body.conversationId as string };
}

describe("making private chats and calls discoverable", () => {
  beforeEach(resetAll);

  it("notifies the owner (in-app and email) when someone starts a chat, without message text", async () => {
    const { o, ph } = await chatPair();
    const n = await o.c.get(notifications.GET, "/x");
    const chat = n.body.notifications.find((x: any) => x.kind === "new_chat");
    expect(chat.title).toContain(ph.handle);
    expect(chat.title).toContain("Bicycle");
    expect(chat.link).toMatch(/^\/chats\//);
    const mail = await lastOutbox({ channel: "email", to: o.email });
    expect(mail.subject).toContain("started a chat");
  });

  it("alerts on new messages at most once per 15 minutes per conversation, never with the text", async () => {
    const { o, caller, convId } = await chatPair();
    await caller.post(chatMessages.POST, "/x", { text: "secret-content-one" }, { id: convId });
    await caller.post(chatMessages.POST, "/x", { text: "secret-content-two" }, { id: convId });
    const rows = await db().select().from(schema.notifications)
      .where(and(eq(schema.notifications.kind, "chat_message")));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("secret-content");
    const n = await o.c.get(notifications.GET, "/x");
    expect(n.body.chatsUnread).toBe(2);
    await o.c.get(chatMessages.GET, "/x", { id: convId });
    expect((await o.c.get(notifications.GET, "/x")).body.chatsUnread).toBe(0);
  });

  it("offers the caller a private call from the chat while their check is valid; the owner can't start one", async () => {
    const { o, caller, ph, convId, requestId } = await chatPair();
    const asCaller = await caller.get(chatMessages.GET, "/x", { id: convId });
    expect(asCaller.body.call).toEqual({ canStart: true, requestId, appCall: true });
    const asOwner = await o.c.get(chatMessages.GET, "/x", { id: convId });
    expect(asOwner.body.call).toMatchObject({ canStart: false, reason: "owner" });

    const r = await caller.post(gateOutcome.POST, "/x", { choice: "app_call" }, { id: requestId });
    expect(r.body.appCallId).toBeTruthy();
    // Phone-network calls are gone: the only call is in the app.
    expect((await caller.post(gateOutcome.POST, "/x", { choice: "relay" }, { id: requestId })).status).toBe(400);
    void ph;
  });

  it("asks the caller to pass the gate again once the request has expired", async () => {
    const { caller, convId, requestId } = await chatPair();
    await db().update(schema.decodeRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.decodeRequests.id, requestId));
    const r = await caller.get(chatMessages.GET, "/x", { id: convId });
    expect(r.body.call).toMatchObject({ canStart: false, reason: "pass_gate_again" });
  });
});
