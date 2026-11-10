import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { toggleReaction } from "@/lib/reactions";

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, z.object({ kind: z.enum(["post", "message", "comment"]), targetId: z.string().uuid(), emoji: z.string().max(8) }));
  return json({ reactions: await toggleReaction(ctx.user.id, b.kind, b.targetId, b.emoji) });
});
