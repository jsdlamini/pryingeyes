import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { reportPost } from "@/lib/social";
import { REPORT_REASONS } from "@/lib/moderation";
import { uuid } from "@/lib/social-http";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, z.object({ reason: z.enum(REPORT_REASONS), details: z.string().max(2000).optional(), block: z.boolean().optional() }));
  const r = await reportPost(ctx.user.id, uuid(id), b.reason, b.details, !!b.block);
  return json({ id: r.id }, 201);
});
