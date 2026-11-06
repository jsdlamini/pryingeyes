import { route, json, withFloor } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { gateStatus } from "@/lib/gate";
import { env } from "@/lib/env";

export const GET = route<{ id: string }>(async (req, { id }) => withFloor(env().GATE_FLOOR_MS, async () => {
  const ctx = await requireUser(req);
  return json(await gateStatus(ctx, id));
}));
