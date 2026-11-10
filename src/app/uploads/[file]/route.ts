import { route } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { canView, CONTENT_TYPES, readUpload, UPLOAD_FILE_RE, type UploadExt } from "@/lib/uploads";

/**
 * Serves an uploaded file only to a signed-in person who may see it (they uploaded it, or can see
 * the message, post, comment or profile that uses it). Everyone else gets the same 404, so the
 * response never confirms that a file exists. Never cached by shared caches.
 */
export const GET = route<{ file: string }>(async (req, { file }) => {
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const m = UPLOAD_FILE_RE.exec(file);
  if (!m) return notFound();
  let userId: string;
  try { userId = (await requireUser(req)).user.id; } catch { return notFound(); }
  if (!(await canView(userId, file))) return notFound();
  const buf = await readUpload(file);
  if (!buf) return notFound();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": CONTENT_TYPES[m[2] as UploadExt],
      "Content-Length": String(buf.length),
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
});
