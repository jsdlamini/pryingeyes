/**
 * Uploaded media (photos, voice notes, short videos).
 *
 * - Every upload is recorded with its owner, so only the owner can attach it to a message, post,
 *   comment or avatar.
 * - Files are checked by their first bytes, never by the type the browser claims.
 * - Photos are re-encoded, which drops EXIF/XMP metadata (GPS position, camera, serial numbers);
 *   the picture stays upright. MP4/MOV user-data and metadata
 *   boxes (where phones store the recording location) are blanked out.
 * - Files are served only to signed-in people who can see something that uses them
 *   (see `canView`), with `Cache-Control: private, no-store`.
 * - Files are deleted when a view-once photo is opened, when its message expires, when the account
 *   is erased, and by the housekeeping sweep once nothing refers to them any more.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "./env";
import { badRequest, HttpError, tooMany } from "./errors";
import { hit } from "./ratelimit";
import { log } from "./log";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2048;
const DAILY_UPLOADS = 100;

export type UploadExt = "jpg" | "png" | "webp" | "gif" | "webm" | "m4a" | "mp3" | "ogg" | "mp4" | "mov" | "m4v";
export const CONTENT_TYPES: Record<UploadExt, string> = {
  jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  webm: "audio/webm", m4a: "audio/mp4", mp3: "audio/mpeg", ogg: "audio/ogg",
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4",
};
export const UPLOAD_URL_RE = /^\/uploads\/([0-9a-f-]{36})\.(jpg|png|webp|gif|webm|m4a|mp3|ogg|mp4|mov|m4v)$/;
export const UPLOAD_FILE_RE = /^([0-9a-f-]{36})\.(jpg|png|webp|gif|webm|m4a|mp3|ogg|mp4|mov|m4v)$/;

/** Where uploads live: UPLOAD_DIR, else a sibling of DATA_DIR (./var/data → ./var/uploads; in Docker /app/var/uploads, as before). */
export const uploadDir = () => path.resolve(env().UPLOAD_DIR.trim() || path.join(path.dirname(path.resolve(env().DATA_DIR)), "uploads"));

/* ───────────────────────── file type sniffing ───────────────────────── */

const startsWith = (b: Buffer, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString("latin1");

/** The real type of a file from its first bytes. `claimed` only chooses between audio and video for MP4/WebM. */
export function sniff(buf: Buffer, claimed: string): UploadExt | null {
  if (buf.length < 12) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (ascii(buf, 0, 6) === "GIF87a" || ascii(buf, 0, 6) === "GIF89a") return "gif";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return "webp";
  if (ascii(buf, 0, 4) === "OggS") return "ogg";
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return claimed.startsWith("audio/") ? "webm" : null; // video/webm isn't offered
  if (ascii(buf, 0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return claimed === "audio/mpeg" ? "mp3" : null;
  const box = ascii(buf, 4, 8);
  if (box === "ftyp" || box === "moov" || box === "wide" || box === "mdat" || box === "free") {
    if (claimed.startsWith("audio/")) return "m4a";
    if (claimed === "video/quicktime" || ascii(buf, 8, 12) === "qt  ") return "mov";
    if (claimed === "video/x-m4v") return "m4v";
    return "mp4";
  }
  return null;
}

/* ───────────────────────── metadata stripping ───────────────────────── */

/**
 * Decodes and re-encodes a photo: metadata is not carried over and large photos are scaled down.
 * The decoder applies the EXIF orientation itself, so the re-encoded picture stays upright.
 */
async function reencodeImage(buf: Buffer, ext: "jpg" | "png" | "webp"): Promise<Buffer> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(buf);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  if (ext === "png") return canvas.encode("png");
  if (ext === "webp") return canvas.encode("webp", 85);
  return canvas.encode("jpeg", 85);
}

/**
 * Blanks the boxes where MP4/MOV files keep descriptive metadata — `udta` (QuickTime ©xyz location,
 * camera make/model) and `meta` (Apple's com.apple.quicktime.location.ISO6709 and friends) — by
 * renaming them to `free`, which every player skips. Sizes are unchanged, so the media still plays.
 */
export function blankMp4Metadata(buf: Buffer): number {
  let blanked = 0;
  const walk = (start: number, end: number, depth: number) => {
    let i = start;
    while (i + 8 <= end) {
      let size = buf.readUInt32BE(i);
      const type = ascii(buf, i + 4, i + 8);
      let header = 8;
      if (size === 1) {
        if (i + 16 > end) return;
        size = Number(buf.readBigUInt64BE(i + 8));
        header = 16;
      } else if (size === 0) size = end - i;
      if (size < header || i + size > end) return;
      if (type === "udta" || type === "meta") { buf.write("free", i + 4, "latin1"); blanked++; }
      else if (depth < 4 && (type === "moov" || type === "trak" || type === "mdia" || type === "minf")) walk(i + header, i + size, depth + 1);
      i += size;
    }
  };
  walk(0, buf.length, 0);
  return blanked;
}

/* ───────────────────────── storing and attaching ───────────────────────── */

/** Stores a file the user uploaded. Returns its public path (/uploads/<id>.<ext>). */
export async function storeUpload(userId: string, file: File): Promise<{ url: string }> {
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "too_large", "Too large (max 10 MB).");
  const b = await hit(`upload:${userId}`, DAILY_UPLOADS, 86400);
  if (!b.allowed) throw tooMany(b.retryAfter, "You've uploaded a lot today. Try again tomorrow.");
  const claimed = (file.type || "").split(";")[0].trim().toLowerCase();
  let buf: Buffer = Buffer.from(await file.arrayBuffer());
  const ext = sniff(buf, claimed);
  if (!ext) throw new HttpError(415, "unsupported_type", "That file type isn't supported.");
  if (ext === "jpg" || ext === "png" || ext === "webp") {
    try { buf = await reencodeImage(buf, ext); }
    catch { throw badRequest("bad_image", "That photo couldn't be read. Try another one."); }
  } else if (ext === "mp4" || ext === "mov" || ext === "m4v" || ext === "m4a") {
    blankMp4Metadata(buf);
  }
  const id = randomUUID();
  await mkdir(uploadDir(), { recursive: true });
  await writeFile(path.join(uploadDir(), `${id}.${ext}`), buf);
  await db().insert(schema.uploads).values({ id, ownerId: userId, ext, size: buf.length });
  return { url: `/uploads/${id}.${ext}` };
}

/**
 * Checks that an attachment path names a file this user uploaded. Returns the path, or null for
 * no attachment. Anything else (someone else's file, a made-up path) is refused.
 */
export async function ownUpload(userId: string, url: string | null | undefined, allowed?: readonly UploadExt[]): Promise<string | null> {
  if (!url) return null;
  const m = UPLOAD_URL_RE.exec(url);
  if (!m || (allowed && !allowed.includes(m[2] as UploadExt))) throw badRequest("bad_attachment", "That attachment can't be used here.");
  const [u] = await db().select({ ownerId: schema.uploads.ownerId, ext: schema.uploads.ext }).from(schema.uploads).where(eq(schema.uploads.id, m[1]));
  if (!u || u.ownerId !== userId || u.ext !== m[2]) throw badRequest("bad_attachment", "Upload the file again, then attach it.");
  return url;
}

/* ───────────────────────── who may see a file ───────────────────────── */

/** May this signed-in user download this file? True when they uploaded it, or can see something that uses it. */
export async function canView(userId: string, file: string): Promise<boolean> {
  const m = UPLOAD_FILE_RE.exec(file);
  if (!m) return false;
  const url = `/uploads/${file}`;
  const [u] = await db().select({ ownerId: schema.uploads.ownerId }).from(schema.uploads).where(eq(schema.uploads.id, m[1]));
  if (u?.ownerId === userId) return true;

  // A chat message in a conversation they take part in.
  const msgs = await db().select({ id: schema.messages.id }).from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(and(eq(schema.messages.attachment, url), or(eq(schema.conversations.ownerId, userId), eq(schema.conversations.callerId, userId))))
    .limit(1);
  if (msgs.length) return true;

  // Profile pictures are shown to every signed-in user.
  const av = await db().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.avatarUrl, url)).limit(1);
  if (av.length) return true;

  // A post or comment they can see.
  const { visiblePost } = await import("./social");
  const posts = await db().select({ id: schema.posts.id }).from(schema.posts).where(eq(schema.posts.attachment, url)).limit(20);
  const comments = await db().select({ postId: schema.comments.postId }).from(schema.comments).where(eq(schema.comments.attachment, url)).limit(20);
  for (const postId of [...posts.map((p) => p.id), ...comments.map((c) => c.postId)]) {
    try { await visiblePost(userId, postId); return true; } catch { /* not visible: keep looking */ }
  }
  return false;
}

export async function readUpload(file: string): Promise<Buffer | null> {
  if (!UPLOAD_FILE_RE.test(file)) return null;
  try { return await readFile(path.join(uploadDir(), file)); } catch { return null; }
}

/* ───────────────────────── deleting ───────────────────────── */

/** Deletes an uploaded file and its record. Quietly does nothing for paths that aren't uploads. */
export async function deleteUpload(url: string | null | undefined) {
  const m = url ? UPLOAD_URL_RE.exec(url) : null;
  if (!m) return;
  try { await unlink(path.join(uploadDir(), `${m[1]}.${m[2]}`)); }
  catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") log.warn({ err }, "upload delete failed"); }
  await db().delete(schema.uploads).where(eq(schema.uploads.id, m[1]));
}

/** Paths of every file a user uploaded (to delete them when the account is erased). */
export async function uploadsOf(userId: string): Promise<string[]> {
  const rows = await db().select({ id: schema.uploads.id, ext: schema.uploads.ext }).from(schema.uploads).where(eq(schema.uploads.ownerId, userId));
  return rows.map((r) => `/uploads/${r.id}.${r.ext}`);
}

async function referenced(urls: string[]): Promise<Set<string>> {
  if (!urls.length) return new Set();
  const [m, p, c, a] = await Promise.all([
    db().select({ u: schema.messages.attachment }).from(schema.messages).where(inArray(schema.messages.attachment, urls)),
    db().select({ u: schema.posts.attachment }).from(schema.posts).where(inArray(schema.posts.attachment, urls)),
    db().select({ u: schema.comments.attachment }).from(schema.comments).where(inArray(schema.comments.attachment, urls)),
    db().select({ u: schema.users.avatarUrl }).from(schema.users).where(inArray(schema.users.avatarUrl, urls)),
  ]);
  return new Set([...m, ...p, ...c, ...a].map((r) => r.u).filter((u): u is string => !!u));
}

/**
 * Housekeeping: deletes files nothing refers to any more (expired or deleted messages, posts and
 * comments, replaced avatars, erased accounts, uploads never attached). Files younger than a day
 * are left alone, so an upload that is about to be attached is never removed.
 */
export async function sweepUploads(limit = 2000): Promise<number> {
  let names: string[];
  try { names = (await readdir(uploadDir())).filter((n) => UPLOAD_FILE_RE.test(n)).slice(0, limit); }
  catch { return 0; }
  const cutoff = Date.now() - 86400_000;
  const old: string[] = [];
  for (const n of names) {
    try { if ((await stat(path.join(uploadDir(), n))).mtimeMs < cutoff) old.push(`/uploads/${n}`); } catch { /* gone */ }
  }
  let removed = 0;
  for (let i = 0; i < old.length; i += 200) {
    const batch = old.slice(i, i + 200);
    const keep = await referenced(batch);
    for (const url of batch) if (!keep.has(url)) { await deleteUpload(url); removed++; }
  }
  return removed;
}
