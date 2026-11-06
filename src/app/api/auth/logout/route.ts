import { route, json } from "@/lib/http";
import { sessionFromRequest, revokeSession, clearSessionCookie } from "@/lib/session";
import { audit } from "@/lib/audit";

export const POST = route(async (req) => {
  const ctx = await sessionFromRequest(req);
  if (ctx) {
    await revokeSession(ctx.session.id);
    await audit({ type: "account.logout", actorId: ctx.user.id, ownerId: ctx.user.id });
  }
  return json({ status: "signed_out" }, 200, { "Set-Cookie": clearSessionCookie() });
});
