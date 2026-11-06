import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { totpConfirm } from "@/lib/accounts";
import { markMfa } from "@/lib/session";

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  const { code } = await readJson(req, z.object({ code: z.string().max(12) }));
  const r = await totpConfirm(ctx.user.id, code);
  await markMfa(ctx.session.id);
  return json({ status: "enrolled", recoveryCodes: r.recoveryCodes });
});
