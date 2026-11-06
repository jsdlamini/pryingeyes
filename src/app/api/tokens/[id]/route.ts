import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireCodeOwner, requireOwner } from "@/lib/auth";
import { setTokenState, rotateToken, extendToken, cloneToken, assertNotDuringPanicWithoutStepUp, tokenHasNumber } from "@/lib/tokens";
import { notFound } from "@/lib/errors";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["pause", "resume", "revoke"]) }),
  z.object({ action: z.literal("rotate") }),
  z.object({ action: z.literal("extend"), hours: z.number().int() }),
  z.object({ action: z.literal("clone"), tier: z.number().int().optional(), label: z.string().max(40).optional(),
    class: z.enum(["standard", "expiring", "disposable", "purpose"]).optional(), ttlHours: z.number().int().positive().nullable().optional() }),
]);

export const POST = route<{ id: string }>(async (req, { id }) => {
  let ctx = await requireCodeOwner(req);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const b = await readJson(req, Body);
  // Pausing or revoking is always allowed. Anything that keeps a number-backed code working needs two-step sign-in.
  if (b.action !== "pause" && b.action !== "revoke" && (await tokenHasNumber(ctx.user.id, id))) ctx = await requireOwner(req);
  switch (b.action) {
    case "pause": case "resume": case "revoke":
      if (b.action === "resume") assertNotDuringPanicWithoutStepUp(ctx.user, ctx.session.mfaAt);
      await setTokenState(ctx.user.id, id, b.action);
      return json({ status: "ok" });
    case "rotate": {
      assertNotDuringPanicWithoutStepUp(ctx.user, ctx.session.mfaAt);
      const r = await rotateToken(ctx.user.id, id);
      return json({ token: { id: r.token.id }, link: r.codes.link, short: r.codes.short });
    }
    case "extend":
      await extendToken(ctx.user.id, id, b.hours);
      return json({ status: "ok" });
    case "clone": {
      assertNotDuringPanicWithoutStepUp(ctx.user, ctx.session.mfaAt);
      const { action: _a, ...changes } = b;
      const r = await cloneToken(ctx.user.id, id, changes);
      return json({ token: { id: r.token.id }, link: r.codes.link, short: r.codes.short }, 201);
    }
  }
});
