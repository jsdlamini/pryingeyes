import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { panicRevokeAll } from "@/lib/tokens";
import { notify } from "@/lib/notify";

/**
 * Panic revoke-all (rule 11). Any fully signed-in session may use it — no step-up, because
 * revoking is always safe. Re-issuing tokens afterwards requires a fresh second factor.
 */
export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  const t0 = performance.now();
  const revoked = await panicRevokeAll(ctx.user.id);
  const ms = Math.round(performance.now() - t0);
  await notify(ctx.user.id, { kind: "security_alert", title: "Panic revoke used", body: `${revoked} token(s) revoked. Old links and codes no longer work.`, link: "/dashboard" });
  return json({ status: "revoked", revoked, ms });
});
