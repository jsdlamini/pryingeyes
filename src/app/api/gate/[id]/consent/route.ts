import { z } from "zod";
import { route, json, readJson, withFloor } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { requestConsent } from "@/lib/gate";
import { env } from "@/lib/env";

export const POST = route<{ id: string }>(async (req, { id }) => withFloor(env().GATE_FLOOR_MS, async () => {
  const ctx = await requireUser(req);
  const b = await readJson(req, z.object({ note: z.string().max(280).optional() }));
  return json(await requestConsent(ctx, id, b.note));
}));
