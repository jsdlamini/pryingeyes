import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { actOnCall, getCall } from "@/lib/calls";

export const GET = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  return json(await getCall(ctx.user.id, id));
});

/** accept / decline (owner), cancel (caller while ringing), hangup (either side). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  const { action } = await readJson(req, z.object({ action: z.enum(["accept", "decline", "cancel", "hangup"]) }));
  return json(await actOnCall(ctx.user.id, id, action));
});
