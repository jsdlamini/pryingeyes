import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser, requireStepUp, hasMfa } from "@/lib/auth";
import { changePassword } from "@/lib/accounts";
import { verifyPassword } from "@/lib/password";
import { badRequest } from "@/lib/errors";
import { revokeOtherSessions } from "@/lib/session";

/** Change password: needs the current password, or a recent passkey/authenticator step-up. */
export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, z.object({ current: z.string().max(128).optional(), password: z.string().max(128) }));
  const currentOk = !!ctx.user.passwordHash && !!b.current && (await verifyPassword(ctx.user.passwordHash, b.current));
  if (!currentOk) {
    if (!(await hasMfa(ctx.user.id))) throw badRequest("current_password", "Enter your current password.");
    requireStepUp(ctx);
  }
  await changePassword(ctx.user.id, b.password);
  await revokeOtherSessions(ctx.user.id, ctx.session.id);
  return json({ status: "changed" });
});
