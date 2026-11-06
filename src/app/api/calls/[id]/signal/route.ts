import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { pullSignals, pushSignal } from "@/lib/calls";

const Signal = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["offer", "answer"]), sdp: z.string().min(10).max(20_000) }),
  z.object({ type: z.literal("ice"), candidate: z.object({
    candidate: z.string().max(1_000), sdpMid: z.string().max(64).nullable().optional(), sdpMLineIndex: z.number().int().min(0).max(16).nullable().optional(),
  }) }),
  z.object({ type: z.literal("restart") }),
]);

/** Pull (and delete) signalling messages waiting for me, plus the call state. Also a heartbeat. */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  return json(await pullSignals(ctx.user.id, id));
});

/** Send an offer/answer/ICE candidate to the other side. Non-relay candidates are dropped. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  const s = await readJson(req, Signal);
  return json(await pushSignal(ctx.user.id, id, s));
});
