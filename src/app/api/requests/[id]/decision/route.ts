import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireCodeOwner, requireOwner } from "@/lib/auth";
import { decide } from "@/lib/gate";
import { requestHasNumber } from "@/lib/tokens";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireCodeOwner(req);
  const { decision } = await readJson(req, z.object({ decision: z.enum(["approve_relay", "reveal_once", "decline", "decline_block"]) }));
  // Showing a phone number is a number-owner action; app-only codes turn it into a plain approval.
  if (decision === "reveal_once" && (await requestHasNumber(ctx.user.id, id))) await requireOwner(req);
  return json(await decide(ctx, id, decision));
});
