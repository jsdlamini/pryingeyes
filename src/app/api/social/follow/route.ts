import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { followUser, unfollowUser } from "@/lib/social";

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, z.object({ handle: z.string().max(24), follow: z.boolean() }));
  return json(b.follow ? await followUser(ctx.user.id, b.handle) : await unfollowUser(ctx.user.id, b.handle));
});
