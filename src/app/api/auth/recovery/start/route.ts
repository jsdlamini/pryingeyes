import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { recoveryStart } from "@/lib/accounts";

/** For an MFA-pending session whose owner has lost their second factor. */
export const POST = route(async (req) => {
  const ctx = await requireUser(req, { allowMfaPending: true });
  const { code } = await readJson(req, z.object({ code: z.string().max(20) }));
  return json(await recoveryStart(ctx.user.id, code));
});
