import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { MAX_UPLOAD_BYTES, storeUpload } from "@/lib/uploads";

/** Upload a photo, voice note or short video. Photos are re-encoded without their metadata (see lib/uploads). */
export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 64 * 1024) return json({ error: "too_large", message: "Too large (max 10 MB)." }, 413);
  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) return json({ error: "no_file", message: "No file." }, 400);
  return json(await storeUpload(ctx.user.id, file), 201);
});
