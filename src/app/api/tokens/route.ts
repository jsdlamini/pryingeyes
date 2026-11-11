import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireCodeOwner, requireOwner } from "@/lib/auth";
import { createToken, listTokens, recommend, assertNotDuringPanicWithoutStepUp } from "@/lib/tokens";
import { recordLoopCodeCreated } from "@/lib/growth";

const Contexts = z.enum(["business", "classifieds", "community", "marketplace", "dating", "new_contact", "other"]);
const Body = z.object({
  numberId: z.string().uuid().nullable().optional(), tier: z.number().int(), class: z.enum(["standard", "expiring", "disposable", "purpose"]),
  label: z.string().max(40), context: Contexts.default("other"),
  ttlHours: z.number().int().positive().nullable().optional(), decodeBudget: z.number().int().positive().nullable().optional(), fromLoop: z.boolean().optional(),
});

export const GET = route(async (req) => {
  const ctx = await requireCodeOwner(req);
  const url = new URL(req.url);
  const context = url.searchParams.get("recommend");
  if (context) return json({ recommendation: recommend(Contexts.parse(context)) });
  return json({ tokens: await listTokens(ctx.user.id) });
});

/**
 * Creates a code. Without `numberId` it's app-only (message and in-app call). With one, the owner
 * needs two-step sign-in. The plaintext link and short code appear in this response only.
 */
export const POST = route(async (req) => {
  const b = await readJson(req, Body);
  const ctx = b.numberId ? await requireOwner(req) : await requireCodeOwner(req);
  assertNotDuringPanicWithoutStepUp(ctx.user, ctx.session.mfaAt);
  const { token, codes } = await createToken(ctx.user.id, b);
  if (b.fromLoop) await recordLoopCodeCreated(ctx.user.id);
  return json({ token: { id: token.id, label: token.label, tier: token.tier, class: token.class, expiresAt: token.expiresAt, displayPrefix: token.displayPrefix, appOnly: !token.numberId },
    link: codes.link, short: codes.short }, 201);
});
