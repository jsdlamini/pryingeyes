import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { listBlocked, unblockUser } from "@/lib/social";

export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  return json({ blocked: await listBlocked(ctx.user.id) });
});

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, z.object({ handle: z.string().max(24) }));
  return json(await unblockUser(ctx.user.id, b.handle));
});
