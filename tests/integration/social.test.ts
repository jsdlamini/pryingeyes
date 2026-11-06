import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { resetAll } from "../helpers";
import { Client } from "../client";
import { owner, emailCaller, startGate } from "../flows";
import { sweepStatuses } from "@/lib/social";
import * as groups from "@/app/api/groups/route";
import * as join from "@/app/api/groups/join/route";
import * as group from "@/app/api/groups/[id]/route";
import * as invite from "@/app/api/groups/[id]/invite/route";
import * as requests from "@/app/api/groups/[id]/requests/route";
import * as askJoin from "@/app/api/groups/[id]/join/route";
import * as discover from "@/app/api/groups/discover/route";
import * as me from "@/app/api/me/route";
import * as chatMessages from "@/app/api/chats/[id]/messages/route";
import * as gateOutcome from "@/app/api/gate/[id]/outcome/route";
import * as leave from "@/app/api/groups/[id]/leave/route";
import * as members from "@/app/api/groups/[id]/members/route";
import * as gposts from "@/app/api/groups/[id]/posts/route";
import * as status from "@/app/api/status/route";
import * as post from "@/app/api/posts/[id]/route";
import * as report from "@/app/api/posts/[id]/report/route";
import * as notifications from "@/app/api/notifications/route";
import * as assetlinks from "@/app/.well-known/assetlinks.json/route";
import * as aasa from "@/app/.well-known/apple-app-site-association/route";
import { resetEnvCache } from "@/lib/env";

const ip = () => `10.80.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
async function member() { const c = new Client("Member/1.0", ip()); const p = await emailCaller(c); return { c, ...p }; }

/** Asks to join with an invite link; an admin approves. */
async function joinApproved(m: Client, admin: Client, groupId: string, inviteLink: string) {
  const j = await m.post(join.POST, "/x", { invite: inviteLink });
  expect(j.body).toEqual({ id: groupId, status: "requested" });
  const meId = (await m.get(me.GET, "/x")).body.user.id;
  const d = await admin.post(requests.POST, "/x", { userId: meId, decision: "approve" }, { id: groupId });
  expect(d.body).toEqual({ status: "approved" });
}

/** An owner who created a group, plus one invited member. */
async function setup() {
  const o = await owner(new Client("Owner/1.0", ip()));
  const g = await o.c.post(groups.POST, "/x", { name: "Manzini Market", about: "Buy and sell around Manzini" });
  expect(g.status).toBe(201);
  const m = await member();
  await joinApproved(m.c, o.c, g.body.id, g.body.invite);
  return { o, m, groupId: g.body.id as string, invite: g.body.invite as string };
}

describe("safe social: groups", () => {
  beforeEach(resetAll);

  it("creates a group with an invite link; members join by link and see each other only by handle", async () => {
    const s = await setup();
    expect(s.invite).toMatch(/\/g\/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const preview = await (await member()).c.post(join.POST, "/x", { invite: s.invite.split("/g/")[1].toLowerCase(), preview: true });
    expect(preview.body.group).toMatchObject({ name: "Manzini Market", members: 2, joined: false, requested: false });

    const d = await s.m.c.get(group.GET, "/x", { id: s.groupId });
    expect(d.body.group.role).toBe("member");
    expect(d.body.group.invite).toBeNull();                       // only admins see the link
    expect(d.body.group.members.map((x: any) => x.handle).sort()).toEqual([s.o.handle, s.m.handle].sort());
    expect(JSON.stringify(d.body)).not.toContain(s.m.email);
    expect(JSON.stringify(d.body)).not.toContain(s.o.phone);

    const list = await s.m.c.get(groups.GET, "/x");
    expect(list.body.groups).toEqual([expect.objectContaining({ id: s.groupId, members: 2, role: "member" })]);
    expect(list.body.pending).toEqual([]);
  });

  it("rejects contact details in group names and descriptions", async () => {
    const o = await member();
    const r = await o.c.post(groups.POST, "/x", { name: "Call 7612 3456 for deals" });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: "contact_info_detected", found: ["phone"] });
    const r2 = await o.c.post(groups.POST, "/x", { name: "Deals", about: "email deals at gmail dot com" });
    expect(r2.body.error).toBe("contact_info_detected");
  });

  it("resetting the invite stops the old link; non-members can't read the group", async () => {
    const s = await setup();
    const n = await s.o.c.post(invite.POST, "/x", {}, { id: s.groupId });
    expect(n.body.invite).not.toBe(s.invite);
    const late = await member();
    expect((await late.c.post(join.POST, "/x", { invite: s.invite })).status).toBe(404);
    expect((await late.c.get(gposts.GET, "/x", { id: s.groupId })).status).toBe(404);
    await joinApproved(late.c, s.o.c, s.groupId, n.body.invite);
    expect((await s.m.c.post(invite.POST, "/x", {}, { id: s.groupId })).status).toBe(403);
  });

  it("admins can remove members; the last admin leaving hands over admin", async () => {
    const s = await setup();
    const ownerId = (await s.o.c.get(group.GET, "/x", { id: s.groupId })).body.group.members.find((mm: any) => mm.you).id;
    expect((await s.m.c.post(members.POST, "/x", { userId: ownerId, action: "remove" }, { id: s.groupId })).status).toBe(403);
    await s.o.c.post(leave.POST, "/x", {}, { id: s.groupId });
    const d = await s.m.c.get(group.GET, "/x", { id: s.groupId });
    expect(d.body.group.role).toBe("admin");
    const x = await member();
    await joinApproved(x.c, s.m.c, s.groupId, (await s.m.c.post(invite.POST, "/x", {}, { id: s.groupId })).body.invite);
    const xid = (await x.c.get(group.GET, "/x", { id: s.groupId })).body.group.members.find((mm: any) => mm.you).id;
    expect((await s.m.c.post(members.POST, "/x", { userId: xid, action: "remove" }, { id: s.groupId })).status).toBe(200);
    expect((await x.c.get(gposts.GET, "/x", { id: s.groupId })).status).toBe(404);
    await s.m.c.post(leave.POST, "/x", {}, { id: s.groupId });
    expect(await db().select().from(schema.groups)).toEqual([]);   // last one out deletes the group
  });
});

describe("safe social: joining needs an admin's approval", () => {
  beforeEach(resetAll);

  it("anyone can find a listed group and ask to join; only admins approve; members only see posts after approval", async () => {
    const s = await setup();
    const asker = await member();
    const found = await asker.c.get(discover.GET, "/x?q=manzini");
    expect(found.body.groups).toEqual([expect.objectContaining({ id: s.groupId, name: "Manzini Market", members: 2, joined: false, requested: false })]);
    expect((await asker.c.post(askJoin.POST, "/x", { note: "I sell vegetables in Manzini" }, { id: s.groupId })).body).toEqual({ id: s.groupId, status: "requested" });
    // Still waiting: no access, and listed as pending.
    expect((await asker.c.get(gposts.GET, "/x", { id: s.groupId })).status).toBe(404);
    expect((await asker.c.get(groups.GET, "/x")).body.pending).toEqual([{ id: s.groupId, name: "Manzini Market" }]);
    expect((await asker.c.get(discover.GET, "/x?q=manzini")).body.groups[0].requested).toBe(true);
    // The admin is told, and sees the request with its note. A plain member can't approve.
    expect(JSON.stringify((await s.o.c.get(notifications.GET, "/x")).body)).toContain("asked to join");
    const reqs = await s.o.c.get(requests.GET, "/x", { id: s.groupId });
    expect(reqs.body.requests).toEqual([expect.objectContaining({ handle: asker.handle, note: "I sell vegetables in Manzini", via: "search" })]);
    expect((await s.o.c.get(groups.GET, "/x")).body.groups[0].requests).toBe(1);
    const askerId = reqs.body.requests[0].userId;
    expect((await s.m.c.post(requests.POST, "/x", { userId: askerId, decision: "approve" }, { id: s.groupId })).status).toBe(403);
    expect((await s.o.c.post(requests.POST, "/x", { userId: askerId, decision: "approve" }, { id: s.groupId })).body).toEqual({ status: "approved" });
    expect((await asker.c.get(gposts.GET, "/x", { id: s.groupId })).status).toBe(200);
    expect(JSON.stringify((await asker.c.get(notifications.GET, "/x")).body)).toContain("You're in");
  });

  it("a designated admin can approve; declined people can ask again; requests can be withdrawn", async () => {
    const s = await setup();
    const mId = (await s.m.c.get(me.GET, "/x")).body.user.id;
    await s.o.c.post(members.POST, "/x", { userId: mId, action: "make_admin" }, { id: s.groupId });
    const a = await member();
    await a.c.post(askJoin.POST, "/x", {}, { id: s.groupId });
    const aId = (await a.c.get(me.GET, "/x")).body.user.id;
    expect((await s.m.c.post(requests.POST, "/x", { userId: aId, decision: "decline" }, { id: s.groupId })).body).toEqual({ status: "declined" });
    expect((await a.c.get(gposts.GET, "/x", { id: s.groupId })).status).toBe(404);
    expect((await a.c.post(askJoin.POST, "/x", {}, { id: s.groupId })).body.status).toBe("requested");
    expect((await a.c.post(askJoin.POST, "/x", { cancel: true }, { id: s.groupId })).body.status).toBe("cancelled");
    expect((await s.m.c.get(requests.GET, "/x", { id: s.groupId })).body.requests).toEqual([]);
    expect((await a.c.post(askJoin.POST, "/x", {}, { id: s.groupId })).body.status).toBe("requested");
    expect((await s.m.c.post(requests.POST, "/x", { userId: aId, decision: "approve" }, { id: s.groupId })).body.status).toBe("approved");
  });

  it("unlisted groups don't show in search and can only be asked to join with the invite link; notes can't carry numbers", async () => {
    const s = await setup();
    await s.o.c.patch(group.PATCH, "/x", { listed: false }, { id: s.groupId });
    const a = await member();
    expect((await a.c.get(discover.GET, "/x?q=manzini")).body.groups).toEqual([]);
    expect((await a.c.post(askJoin.POST, "/x", {}, { id: s.groupId })).status).toBe(404);
    const bad = await a.c.post(join.POST, "/x", { invite: s.invite, note: "call me 7612 3456" });
    expect(bad.body.error).toBe("contact_info_detected");
    const ok = await a.c.post(join.POST, "/x", { invite: s.invite, note: "Thandi from church" });
    expect(ok.body.status).toBe("requested");
    expect((await s.o.c.get(requests.GET, "/x", { id: s.groupId })).body.requests[0]).toMatchObject({ via: "invite", note: "Thandi from church" });
  });
});

describe("safe social: posts and contact codes", () => {
  beforeEach(resetAll);

  it("blocks phone numbers in posts, including disguised ones, and logs the attempt", async () => {
    const s = await setup();
    for (const text of ["Fridge for sale, call 7612 3456", "whatsapp seven six one two three four five six", "wa.me/26876123456", "me at gmail dot com"]) {
      const r = await s.m.c.post(gposts.POST, "/x", { text }, { id: s.groupId });
      expect(r.status, text).toBe(400);
      expect(r.body.error).toBe("contact_info_detected");
      expect(r.body.message).toMatch(/contact code/);
    }
    const ev = await db().select().from(schema.auditEvents).where(eq(schema.auditEvents.type, "post.rejected_contact"));
    expect(ev.length).toBe(4);
    expect((await s.m.c.get(gposts.GET, "/x", { id: s.groupId })).body.posts).toEqual([]);
  });

  it("an owner attaches a contact code; members tap it and reach them through the gate", async () => {
    const s = await setup();
    const p = await s.o.c.post(gposts.POST, "/x", { text: "Selling a fridge, E1,500", attach: { numberId: s.o.numberId, tier: 1 } }, { id: s.groupId });
    expect(p.status).toBe(201);
    const feed = await s.m.c.get(gposts.GET, "/x", { id: s.groupId });
    const [item] = feed.body.posts;
    expect(item).toMatchObject({ text: "Selling a fridge, E1,500", mine: false, canDelete: false, author: { handle: s.o.handle } });
    expect(item.code).toMatchObject({ tier: 1, live: true });
    expect(item.code.link).toMatch(/\/t\/[0-9A-Z-]{19}$/);
    expect(item.code.short).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(JSON.stringify(feed.body)).not.toContain(s.o.phone);

    // Tapping the code opens the gate with it filled in.
    const g = await startGate(s.m.c, item.code.link);
    expect(g.body).toMatchObject({ status: "ok", label: "Group: Manzini Market" });

    // Later posts in the same group reuse the same code; a different group gets its own.
    await s.o.c.post(gposts.POST, "/x", { text: "Also a stove", attach: { numberId: s.o.numberId, tier: 1 } }, { id: s.groupId });
    const again = (await s.m.c.get(gposts.GET, "/x", { id: s.groupId })).body.posts;
    expect(again[0].code.short).toBe(item.code.short);
    const g2 = await s.o.c.post(groups.POST, "/x", { name: "Church choir" });
    await s.o.c.post(gposts.POST, "/x", { text: "", attach: { numberId: s.o.numberId, tier: 1 } }, { id: g2.body.id });
    const other = (await s.o.c.get(gposts.GET, "/x", { id: g2.body.id })).body.posts[0];
    expect(other.code.short).not.toBe(item.code.short);
    expect(await db().select().from(schema.tokens)).toHaveLength(2);
  });

  it("a revoked code shows as switched off", async () => {
    const s = await setup();
    await s.o.c.post(gposts.POST, "/x", { text: "Hi", attach: { numberId: s.o.numberId, tier: 2 } }, { id: s.groupId });
    await db().update(schema.tokens).set({ status: "revoked" });
    const [item] = (await s.m.c.get(gposts.GET, "/x", { id: s.groupId })).body.posts;
    expect(item.code.live).toBe(false);
  });

  it("attaching a code needs a protected number and two-step sign-in", async () => {
    const s = await setup();
    const r = await s.m.c.post(gposts.POST, "/x", { text: "Reach me", attach: { numberId: s.o.numberId, tier: 1 } }, { id: s.groupId });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("owner_setup_required");
    // Plain posts are fine for everyone.
    expect((await s.m.c.post(gposts.POST, "/x", { text: "Is the fridge still available?" }, { id: s.groupId })).status).toBe(201);
  });

  it("authors and admins delete posts; reports reach moderators and group admins", async () => {
    const s = await setup();
    const third = await member();
    await joinApproved(third.c, s.o.c, s.groupId, s.invite);
    const p = await third.c.post(gposts.POST, "/x", { text: "Cheap phones, no questions asked" }, { id: s.groupId });
    expect((await s.m.c.del(post.DELETE, "/x", { id: p.body.id })).status).toBe(403);

    const r = await s.m.c.post(report.POST, "/x", { reason: "scam", block: true }, { id: p.body.id });
    expect(r.status).toBe(201);
    const [rep] = await db().select().from(schema.reports);
    expect(rep.postId).toBe(p.body.id);
    const n = await s.o.c.get(notifications.GET, "/x");
    expect(JSON.stringify(n.body)).toContain("was reported");
    // The reporter blocked the author, so the post is hidden for them.
    expect((await s.m.c.get(gposts.GET, "/x", { id: s.groupId })).body.posts).toEqual([]);

    expect((await s.o.c.del(post.DELETE, "/x", { id: p.body.id })).status).toBe(200);   // admin removes it
    expect((await third.c.get(gposts.GET, "/x", { id: s.groupId })).body.posts).toEqual([]);
  });
});

describe("contact codes anywhere: one-person, 24-hour, and in chats", () => {
  beforeEach(resetAll);

  it("a one-person code attached to a post works once, then shows as used", async () => {
    const s = await setup();
    await s.o.c.post(gposts.POST, "/x", { text: "One buyer only", attach: { numberId: s.o.numberId, tier: 1, kind: "one" } }, { id: s.groupId });
    const [p] = (await s.m.c.get(gposts.GET, "/x", { id: s.groupId })).body.posts;
    expect(p.code).toMatchObject({ kind: "one", state: "live", live: true });
    const g = await startGate(s.m.c, p.code.link);
    expect((await s.m.c.post(gateOutcome.POST, "/x", { choice: "chat" }, { id: g.body.requestId })).body.conversationId).toBeTruthy();
    const after = (await s.m.c.get(gposts.GET, "/x", { id: s.groupId })).body.posts[0];
    expect(after.code).toMatchObject({ state: "used", live: false });
    // A second code of the same kind is new, not reused.
    await s.o.c.post(gposts.POST, "/x", { text: "Another", attach: { numberId: s.o.numberId, tier: 1, kind: "one" } }, { id: s.groupId });
    const two = (await s.m.c.get(gposts.GET, "/x", { id: s.groupId })).body.posts;
    expect(two[0].code.short).not.toBe(two[1].code.short);
  });

  it("a 24-hour code on a status expires with it", async () => {
    const s = await setup();
    await s.o.c.post(status.POST, "/x", { text: "Today only", attach: { tier: 1, kind: "day" } });
    const mine = (await s.m.c.get(status.GET, "/x")).body.people.find((x: any) => x.author.handle === s.o.handle);
    expect(mine.items[0].code).toMatchObject({ kind: "day", state: "live" });
    const [t] = await db().select().from(schema.tokens).where(eq(schema.tokens.class, "expiring"));
    expect(t.expiresAt!.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
  });

  it("a code shared in a private chat arrives as a link that opens the gate for whoever taps it", async () => {
    const s = await setup();
    const t = await (await import("../flows")).mintToken(s.o.c, s.o.numberId, { tier: 1, label: "Bakkie" });
    const g = await startGate(s.m.c, t.link);
    const conv = (await s.m.c.post(gateOutcome.POST, "/x", { choice: "chat" }, { id: g.body.requestId })).body.conversationId;
    // The owner shares a one-person code in the chat (e.g. for the buyer's brother).
    const r = await s.o.c.post(chatMessages.POST, "/x", { text: "My brother can use this", attach: { tier: 1, kind: "one" } }, { id: conv });
    expect(r.status).toBe(201);
    const msgs = (await s.m.c.get(chatMessages.GET, "/x", { id: conv })).body.messages;
    const link = msgs[msgs.length - 1].text.match(/https?:\/\/\S+\/t\/[0-9A-Z-]+/)![0];
    const [tok] = await db().select().from(schema.tokens).where(eq(schema.tokens.label, `Shared with @${s.m.handle}`));
    expect(tok.class).toBe("disposable");
    const brother = await member();
    expect((await startGate(brother.c, link)).body).toMatchObject({ status: "ok", label: `Shared with @${s.m.handle}` });
  });
});

describe("safe social: status updates", () => {
  beforeEach(resetAll);

  it("shows statuses for 24 hours to people who share a group, never to strangers", async () => {
    const s = await setup();
    const stranger = await member();
    const bad = await s.m.c.post(status.POST, "/x", { text: "New number: 76 12 34 56" });
    expect(bad.body.error).toBe("contact_info_detected");
    expect((await s.o.c.post(status.POST, "/x", { text: "Open today until 5", attach: { numberId: s.o.numberId, tier: 2 } })).status).toBe(201);
    await s.m.c.post(status.POST, "/x", { text: "Back from holiday" });

    const mine = (await s.o.c.get(status.GET, "/x")).body.people;
    expect(mine[0]).toMatchObject({ you: true, author: { handle: s.o.handle } });
    expect(mine[1].items[0].text).toBe("Back from holiday");
    const theirs = (await s.m.c.get(status.GET, "/x")).body.people;
    const ownerEntry = theirs.find((x: any) => x.author.handle === s.o.handle);
    expect(ownerEntry.items[0].code).toMatchObject({ live: true, tier: 2 });
    expect((await stranger.c.get(status.GET, "/x")).body.people).toEqual([]);

    await db().update(schema.posts).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await s.m.c.get(status.GET, "/x")).body.people).toEqual([]);
    expect(await sweepStatuses()).toBe(2);
  });
});

describe("app links", () => {
  it("publishes Android and iOS association files from settings", async () => {
    process.env.ANDROID_CERT_SHA256 = "aa:bb:cc"; process.env.IOS_TEAM_ID = "ABCDE12345"; resetEnvCache();
    try {
      const a = await (assetlinks.GET()).json();
      expect(a[0].target).toEqual({ namespace: "android_app", package_name: "com.pryingeyes.app", sha256_cert_fingerprints: ["AA:BB:CC"] });
      const i = await (aasa.GET()).json();
      expect(i.applinks.details[0]).toEqual({ appIDs: ["ABCDE12345.com.pryingeyes.app"], components: [{ "/": "/t/*" }, { "/": "/g/*" }] });
    } finally { delete process.env.ANDROID_CERT_SHA256; delete process.env.IOS_TEAM_ID; resetEnvCache(); }
  });
});
