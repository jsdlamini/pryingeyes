import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { totpVerify } from "@/lib/accounts";
import { markMfa } from "@/lib/session";

/** Completes sign-in for an MFA-pending session, or performs a step-up on a full session. */
export const POST = route(async (req) => {
  const ctx = await requireUser(req, { allowMfaPending: true, allowPending: true });
  const { code } = await readJson(req, z.object({ code: z.string().max(12) }));
  await totpVerify(ctx.user.id, code);
  await markMfa(ctx.session.id);
  return json({ status: "verified" });
});
