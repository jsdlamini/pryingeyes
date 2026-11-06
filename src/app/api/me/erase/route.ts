import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser, requireStepUp, hasMfa } from "@/lib/auth";
import { eraseAccount } from "@/lib/dsr";
import { clearSessionCookie } from "@/lib/session";

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  await readJson(req, z.object({ confirm: z.literal("DELETE MY ACCOUNT") }));
  if (await hasMfa(ctx.user.id)) requireStepUp(ctx, 15);
  await eraseAccount(ctx.user.id);
  return json({ status: "erased" }, 200, { "Set-Cookie": clearSessionCookie() });
});
