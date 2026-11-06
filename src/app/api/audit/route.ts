import { route, json } from "@/lib/http";
import { requireCodeOwner } from "@/lib/auth";
import { ownerFeed } from "@/lib/feed";

export const GET = route(async (req) => {
  const ctx = await requireCodeOwner(req);
  const before = Number(new URL(req.url).searchParams.get("before") ?? 0) || undefined;
  return json({ events: await ownerFeed(ctx.user.id, { limit: 50, beforeSeq: before }) });
});
