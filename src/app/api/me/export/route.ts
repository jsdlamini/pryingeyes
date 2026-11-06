import { route, json } from "@/lib/http";
import { requireUser, requireStepUp, hasMfa } from "@/lib/auth";
import { exportData } from "@/lib/dsr";

/** Self-service data export. Needs a recent second factor when one is enrolled. */
export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  if (await hasMfa(ctx.user.id)) requireStepUp(ctx, 15);
  const data = await exportData(ctx.user.id);
  return json(data, 200, { "Content-Disposition": `attachment; filename="pryingeyes-my-data-${new Date().toISOString().slice(0, 10)}.json"` });
});
