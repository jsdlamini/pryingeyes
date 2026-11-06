import { z } from "zod";
import { route, json, readJson, clientIp, edgeCountry, withFloor } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { startGate } from "@/lib/gate";
import { env } from "@/lib/env";

export const POST = route(async (req) => withFloor(env().GATE_FLOOR_MS, async () => {
  const ctx = await requireUser(req);
  const b = await readJson(req, z.object({ code: z.string().max(200), captcha: z.string().max(4096).nullable().optional() }));
  return json(await startGate(ctx, b, clientIp(req), edgeCountry(req)));
}));
