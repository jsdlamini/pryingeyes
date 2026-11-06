import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { recoveryCancel } from "@/lib/accounts";

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  return json({ cancelled: await recoveryCancel(ctx.user.id) });
});
