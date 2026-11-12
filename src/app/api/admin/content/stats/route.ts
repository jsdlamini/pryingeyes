import { route, json } from "@/lib/http";
import { requireUser, requireRole } from "@/lib/auth";
import { contentStats } from "@/lib/content";

/** Admin-only: pace, category mix and queue for the Stats tab. */
export const GET = route(async (req) => {
  const ctx = await requireUser(req); requireRole(ctx, "admin");
  return json({ stats: await contentStats(14) });
});
