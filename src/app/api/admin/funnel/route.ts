import { route, json } from "@/lib/http";
import { requireUser, requireRole } from "@/lib/auth";
import { funnelTotals } from "@/lib/funnel";

export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  requireRole(ctx, "admin");
  return json({ totals: await funnelTotals(30) });
});
