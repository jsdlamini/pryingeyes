import { route, json } from "@/lib/http";
import { requireUser, requireRole } from "@/lib/auth";
import { moderationQueue } from "@/lib/moderation";

export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  requireRole(ctx, "moderator");
  const s = new URL(req.url).searchParams.get("status");
  const status = s === "actioned" || s === "dismissed" ? s : "open";
  return json({ reports: await moderationQueue(status) });
});
