import { route, json } from "@/lib/http";
import { requireUser, hasMfa, requireStepUp } from "@/lib/auth";
import { registrationOptions } from "@/lib/webauthn";

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  if (await hasMfa(ctx.user.id)) requireStepUp(ctx);
  return json(await registrationOptions(ctx.user));
});
