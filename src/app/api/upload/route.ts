import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX = 10 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "audio/webm": "webm", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/ogg": "ogg", "video/mp4": "mp4", "video/quicktime": "mov", "video/x-m4v": "m4v" };

export const POST = route(async (req) => {
  await requireUser(req);
  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) return json({ error: "No file." }, 400);
  if (file.size > MAX) return json({ error: "Too large (max 10 MB)." }, 413);
  const type = (file.type || "").split(";")[0].trim().toLowerCase();
  const ext = EXT[type];
  if (!ext) return json({ error: "That file type isn't supported." }, 415);
  const name = `${randomUUID()}.${ext}`;
  const dir = path.join("/app/var", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return json({ url: `/uploads/${name}` }, 201);
});
