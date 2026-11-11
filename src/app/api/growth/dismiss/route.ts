import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { dismissGrowthLoop } from "@/lib/growth";

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  await dismissGrowthLoop(ctx.user.id);
  return json({ status: "ok" });
});
