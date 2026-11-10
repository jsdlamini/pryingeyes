import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { resetAll } from "../helpers";
import { Client } from "../client";
import { owner, emailCaller, mintToken, startGate } from "../flows";
import * as uploadRoute from "@/app/api/upload/route";
import * as serve from "@/app/uploads/[file]/route";
import * as status from "@/app/api/status/route";
import * as settings from "@/app/api/me/settings/route";
import * as chatMessages from "@/app/api/chats/[id]/messages/route";
import * as consume from "@/app/api/chats/[id]/messages/[messageId]/consume/route";
import * as gateOutcome from "@/app/api/gate/[id]/outcome/route";
import * as reactions from "@/app/api/reactions/route";
import * as linkPreview from "@/app/api/link-preview/route";
import { blankMp4Metadata, sniff, sweepUploads, uploadDir } from "@/lib/uploads";
import { isBlockedAddress } from "@/lib/safe-fetch";

const BASE = "http://localhost:3100";
const ip = () => `10.90.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;

/** Multipart upload the way the browser sends it (the shared Client only speaks JSON). */
async function upload(c: Client, bytes: Buffer, type: string, name = "file.bin") {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
  const res = await uploadRoute.POST(new Request(`${BASE}/api/upload`, {
    method: "POST", body: fd, headers: { origin: BASE, "user-agent": c.ua, "x-forwarded-for": c.ip, ...(c.cookie ? { cookie: c.cookie } : {}) },
  }));
  return { status: res.status, body: await res.json() };
}

async function fetchFile(c: Client | null, url: string) {
  const file = url.replace("/uploads/", "");
  const headers: Record<string, string> = { "user-agent": c?.ua ?? "anon", "x-forwarded-for": c?.ip ?? "10.0.0.9" };
  if (c?.cookie) headers.cookie = c.cookie;
  const res = await serve.GET(new Request(`${BASE}${url}`, { headers }), { params: Promise.resolve({ file }) });
  return { status: res.status, cache: res.headers.get("cache-control"), bytes: Buffer.from(await res.arrayBuffer()) };
}

/** A real JPEG with an EXIF block that carries a GPS marker and orientation 6 (rotated 90°). */
async function jpegWithGps(): Promise<Buffer> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const cv = createCanvas(40, 20);
  const ctx = cv.getContext("2d"); ctx.fillStyle = "#0E7490"; ctx.fillRect(0, 0, 40, 20);
  const jpeg = await cv.encode("jpeg", 90);
  // Minimal big-endian TIFF: IFD0 with Orientation=6, then a recognisable "GPS" payload.
  const tiff = Buffer.alloc(26 + 32);
  tiff.write("MM", 0, "latin1"); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);                                 // one entry
  tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(6, 18);
  tiff.writeUInt32BE(0, 22);                                // no next IFD
  tiff.write("GPSLatitude-26.3054,31.1367-SECRET", 26, "latin1");
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1 = Buffer.alloc(4); app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), app1, body, jpeg.subarray(2)]);
}

describe("uploaded media is private, clean and owned", () => {
  beforeEach(resetAll);

  it("strips EXIF (location) from photos, keeps them upright, and refuses files that aren't what they claim", async () => {
    const a = new Client("A/1.0", ip()); await emailCaller(a);
    const src = await jpegWithGps();
    const up = await upload(a, src, "image/jpeg", "photo.jpg");
    expect(up.status).toBe(201);
    const stored = fs.readFileSync(path.join(uploadDir(), up.body.url.replace("/uploads/", "")));
    expect(stored.includes(Buffer.from("SECRET"))).toBe(false);
    expect(stored.includes(Buffer.from("Exif"))).toBe(false);
    const { loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(stored);
    expect([img.width, img.height]).toEqual([20, 40]);       // orientation 6 applied: portrait now

    expect((await upload(a, Buffer.from("<html>not an image</html>"), "image/png")).status).toBe(415);
    expect((await upload(new Client("anon", ip()), src, "image/jpeg")).status).toBe(401);
  });

  it("serves a chat photo only to the two people in the chat, never from a shared cache", async () => {
    const o = await owner(new Client("Owner/1.0", ip()));
    const m = new Client("Caller/1.0", ip()); await emailCaller(m);
    const stranger = new Client("Stranger/1.0", ip()); await emailCaller(stranger);
    const t = await mintToken(o.c, o.numberId, { tier: 1 });
    const g = await startGate(m, t.link);
    const conv = (await m.post(gateOutcome.POST, "/x", { choice: "chat" }, { id: g.body.requestId })).body.conversationId;

    const up = await upload(m, await jpegWithGps(), "image/jpeg");
    const sent = await m.post(chatMessages.POST, "/x", { text: "", attachment: up.body.url, attachmentKind: "image", viewOnce: true }, { id: conv });
    expect(sent.status).toBe(201);

    const mine = await fetchFile(m, up.body.url);
    expect(mine.status).toBe(200);
    expect(mine.cache).toContain("private");
    expect((await fetchFile(stranger, up.body.url)).status).toBe(404);
    expect((await fetchFile(null, up.body.url)).status).toBe(404);
    expect((await fetchFile(o.c, up.body.url)).status).toBe(200);

    // The stranger can't react to a message in someone else's chat either.
    expect((await stranger.post(reactions.POST, "/x", { kind: "message", targetId: sent.body.id, emoji: "👍" })).status).toBe(404);
    expect((await o.c.post(reactions.POST, "/x", { kind: "message", targetId: sent.body.id, emoji: "🍕" })).status).toBe(400);
    expect((await o.c.post(reactions.POST, "/x", { kind: "message", targetId: sent.body.id, emoji: "👍" })).status).toBe(200);

    // Opening a view-once photo deletes the file itself, not just the pointer.
    const file = path.join(uploadDir(), up.body.url.replace("/uploads/", ""));
    expect(fs.existsSync(file)).toBe(true);
    expect((await o.c.post(consume.POST, "/x", {}, { id: conv, messageId: sent.body.id })).body).toEqual({ consumed: true });
    expect(fs.existsSync(file)).toBe(false);
    expect((await fetchFile(m, up.body.url)).status).toBe(404);
  });

  it("only lets you attach files you uploaded yourself", async () => {
    const a = new Client("A/1.0", ip()); await emailCaller(a);
    const b = new Client("B/1.0", ip()); await emailCaller(b);
    const up = await upload(a, await jpegWithGps(), "image/jpeg");
    expect((await b.post(status.POST, "/x", { text: "look", attachment: up.body.url })).status).toBe(400);
    expect((await b.patch(settings.PATCH, "/x", { avatarUrl: up.body.url })).status).toBe(400);
    expect((await a.post(status.POST, "/x", { text: "look", attachment: up.body.url })).status).toBe(201);
    // A status is public to signed-in people, so b may now see it.
    expect((await fetchFile(b, up.body.url)).status).toBe(200);
  });

  it("housekeeping deletes files nothing refers to after a day, and keeps the rest", async () => {
    const a = new Client("A/1.0", ip()); await emailCaller(a);
    const used = await upload(a, await jpegWithGps(), "image/jpeg");
    const loose = await upload(a, await jpegWithGps(), "image/jpeg");
    expect((await a.patch(settings.PATCH, "/x", { avatarUrl: used.body.url })).body).toEqual({ status: "saved" });
    const old = new Date(Date.now() - 2 * 86400_000);
    for (const u of [used, loose]) fs.utimesSync(path.join(uploadDir(), u.body.url.replace("/uploads/", "")), old, old);
    expect(await sweepUploads()).toBe(1);
    expect(fs.existsSync(path.join(uploadDir(), used.body.url.replace("/uploads/", "")))).toBe(true);
    expect(fs.existsSync(path.join(uploadDir(), loose.body.url.replace("/uploads/", "")))).toBe(false);
    const rows = await db().select().from(schema.uploads).where(eq(schema.uploads.ownerId, (await db().select().from(schema.uploads))[0].ownerId));
    expect(rows).toHaveLength(1);
  });
});

describe("file checks", () => {
  it("recognises files by their bytes", () => {
    expect(sniff(Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), "image/png")).toBe("png");
    expect(sniff(Buffer.from("GIF89a\0\0\0\0\0\0", "latin1"), "image/gif")).toBe("gif");
    expect(sniff(Buffer.from("OggS\0\0\0\0\0\0\0\0", "latin1"), "audio/ogg")).toBe("ogg");
    expect(sniff(Buffer.from("\0\0\0\x18ftypqt  \0\0\0\0", "latin1"), "video/quicktime")).toBe("mov");
    expect(sniff(Buffer.from("not a file at all", "latin1"), "image/jpeg")).toBe(null);
  });

  it("blanks the MP4/MOV boxes that hold the recording location", () => {
    const box = (type: string, payload: Buffer) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + payload.length, 0); h.write(type, 4, "latin1"); return Buffer.concat([h, payload]); };
    const xyz = box("©xyz", Buffer.from("+26.3054+031.1367/", "latin1"));
    const file = Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0", "latin1")), box("moov", Buffer.concat([box("mvhd", Buffer.alloc(8)), box("udta", xyz), box("trak", box("meta", Buffer.alloc(4)))]))]);
    expect(blankMp4Metadata(file)).toBe(2);
    expect(file.includes(Buffer.from("udta"))).toBe(false);
    expect(file.includes(Buffer.from("mvhd"))).toBe(true);
  });
});

describe("link previews can't reach the server's own network", () => {
  beforeEach(resetAll);

  it("blocks loopback, private, link-local and carrier-grade NAT addresses, by number or by name", async () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedAddress(a), a).toBe(true);
    }
    expect(isBlockedAddress("41.211.10.10")).toBe(false);
    const a = new Client("A/1.0", ip()); await emailCaller(a);
    for (const u of ["http://127.0.0.1:3000/", "http://localhost/", "http://[::1]/", "http://0x7f.1/", "http://169.254.169.254/latest/meta-data/"]) {
      const r = await a.get(linkPreview.GET, `/api/link-preview?url=${encodeURIComponent(u)}`);
      expect(r.body.error, u).toBe("blocked");
    }
  });
});
