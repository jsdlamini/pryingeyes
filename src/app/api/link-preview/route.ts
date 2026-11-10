import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { hit } from "@/lib/ratelimit";
import { tooMany } from "@/lib/errors";
import { safeFetchHtml, UnsafeTarget } from "@/lib/safe-fetch";

function og(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["'](?:og:)?${prop}["'][^>]+content=["']([^"']+)["']` +
    `|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:)?${prop}["']`,
    "i",
  );
  const m = html.match(re);
  return m ? (m[1] ?? m[2]) : null;
}

/** Title and description of a pasted link. Inside addresses are refused (see lib/safe-fetch). */
export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  const b = await hit(`linkpreview:${ctx.user.id}`, 60, 3600);
  if (!b.allowed) throw tooMany(b.retryAfter, "Too many link previews. Try again later.");
  const raw = new URL(req.url).searchParams.get("url") ?? "";
  let u: URL;
  try { u = new URL(raw); } catch { return json({ error: "invalid_url" }, 400); }
  if (!["http:", "https:"].includes(u.protocol)) return json({ error: "invalid_url" }, 400);
  const empty = { url: u.toString(), host: u.host, title: null, image: null, description: null };

  try {
    const res = await safeFetchHtml(u.toString());
    const html = res.body;
    const title = og(html, "title") ?? (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? null);
    const image = og(html, "image");
    return json({
      ...empty,
      title: title?.slice(0, 200) ?? null,
      image: image && /^https:\/\//i.test(image) ? image.slice(0, 500) : null,
      description: og(html, "description")?.slice(0, 300) ?? null,
    });
  } catch (err) {
    if (err instanceof UnsafeTarget) return json({ error: "blocked" }, 400);
    return json(empty);
  }
});
