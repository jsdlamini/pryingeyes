import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser, hasMfa } from "@/lib/auth";
import { verifyRegistration } from "@/lib/webauthn";
import { generateRecoveryCodes } from "@/lib/accounts";
import { markMfa } from "@/lib/session";
import { audit } from "@/lib/audit";

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  const { response, name } = await readJson(req, z.object({ response: z.any(), name: z.string().max(40).optional() }));
  const first = !(await hasMfa(ctx.user.id));
  await verifyRegistration(ctx.user.id, response, name);
  await audit({ type: "account.passkey_added", actorId: ctx.user.id, ownerId: ctx.user.id });
  if (first) await audit({ type: "account.mfa_enrolled", actorId: ctx.user.id, ownerId: ctx.user.id, payload: { factor: "passkey" } });
  await markMfa(ctx.session.id);
  return json({ status: "enrolled", recoveryCodes: first ? await generateRecoveryCodes(ctx.user.id) : null });
});
