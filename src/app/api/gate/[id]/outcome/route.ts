import { z } from "zod";
import { route, json, readJson, withFloor } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { chooseOutcome } from "@/lib/gate";
import { env } from "@/lib/env";

export const POST = route<{ id: string }>(async (req, { id }) => withFloor(env().GATE_FLOOR_MS, async () => {
  const ctx = await requireUser(req);
  const { choice } = await readJson(req, z.object({ choice: z.enum(["reveal", "chat", "app_call"]) }));
  const r = await chooseOutcome(ctx, id, choice);
  return json({ ...r.view, revealUrl: "revealUrl" in r ? r.revealUrl : undefined, callId: "callId" in r ? r.callId : undefined, appCallId: "appCallId" in r ? r.appCallId : undefined,
    conversationId: "conversationId" in r ? r.conversationId : undefined });
}));
