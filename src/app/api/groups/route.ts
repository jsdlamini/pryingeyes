import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { createGroup, listGroups } from "@/lib/social";

export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  return json(await listGroups(ctx.user.id));
});

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, z.object({ name: z.string().max(200), about: z.string().max(2000).optional(), listed: z.boolean().optional() }));
  return json(await createGroup(ctx.user.id, b), 201);
});
