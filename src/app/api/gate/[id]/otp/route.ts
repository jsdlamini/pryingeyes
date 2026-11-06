import { z } from "zod";
import { route, json, readJson, withFloor } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { sendGateOtp, verifyGateOtp } from "@/lib/gate";
import { env } from "@/lib/env";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send") }),
  z.object({ action: z.literal("verify"), code: z.string().max(12) }),
]);

export const POST = route<{ id: string }>(async (req, { id }) => withFloor(env().GATE_FLOOR_MS, async () => {
  const ctx = await requireUser(req);
  const b = await readJson(req, Body);
  return json(b.action === "send" ? await sendGateOtp(ctx, id) : await verifyGateOtp(ctx, id, b.code));
}));
