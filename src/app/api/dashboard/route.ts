import { route, json } from "@/lib/http";
import { requireCodeOwner } from "@/lib/auth";
import { dashboardSummary } from "@/lib/feed";

export const GET = route(async (req) => {
  const ctx = await requireCodeOwner(req);
  return json(await dashboardSummary(ctx.user.id));
});
