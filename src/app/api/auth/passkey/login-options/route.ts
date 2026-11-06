import { route, json } from "@/lib/http";
import { sessionFromRequest } from "@/lib/session";
import { authenticationOptions } from "@/lib/webauthn";

/** With a session (MFA pending or step-up), only that user's passkeys are offered. */
export const POST = route(async (req) => {
  const ctx = await sessionFromRequest(req);
  return json(await authenticationOptions(ctx?.user.id));
});
