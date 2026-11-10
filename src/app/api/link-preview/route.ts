import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";

function blocked(host: string): boolean {
  if (host === "localhost" || host === "0.0.0.0" || host.endsWith(".local")) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return true;
  if (host === "169.254.169.254") return true; // cloud metadata
  return false;
}

function og(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["'](?:og:)?${prop}["'][^>]+content=["']([^"']+)["']` +
    `|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:)?${prop}["']`,
    "i",
  );
  const m = html.match(re);
  return m ? (m[1] ?? m[2]) : null;
}

export const GET = route(async (req) => {
  await requireUser(req);
  const raw = new URL(req.url).searchParams.get("url") ?? "";
  let u: URL;
  try { u = new URL(raw); } catch { return json({ error: "invalid_url" }, 400); }
  if (!["http:", "https:"].includes(u.protocol)) return json({ error: "invalid_url" }, 400);
  if (blocked(u.hostname)) return json({ error: "blocked" }, 400);

  try {
    const res = await fetch(u.toString(), { headers: { "User-Agent": "Mozilla/5.0 PryingEyes/1.0" }, signal: AbortSignal.timeout(4000), redirect: "follow" });
    const html = await res.text();
    const title = og(html, "title") ?? (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? null);
    return json({
      url: u.toString(), host: u.host,
      title: title?.slice(0, 200) ?? null,
      image: og(html, "image") ?? null,
      description: og(html, "description")?.slice(0, 300) ?? null,
    });
  } catch {
    return json({ url: u.toString(), host: u.host, title: null, image: null, description: null });
  }
});
