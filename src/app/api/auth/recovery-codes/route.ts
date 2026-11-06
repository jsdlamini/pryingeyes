import { route, json } from "@/lib/http";
import { requireUser, requireStepUp, hasMfa } from "@/lib/auth";
import { generateRecoveryCodes } from "@/lib/accounts";
import { badRequest } from "@/lib/errors";

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  if (!(await hasMfa(ctx.user.id))) throw badRequest("mfa_required", "Set up two-step sign-in first.");
  requireStepUp(ctx);
  return json({ recoveryCodes: await generateRecoveryCodes(ctx.user.id) });
});
