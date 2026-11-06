import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser, requireRole } from "@/lib/auth";
import { moderate } from "@/lib/moderation";
import { notFound } from "@/lib/errors";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  requireRole(ctx, "moderator");
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const b = await readJson(req, z.object({ action: z.enum(["dismiss", "warn", "suspend", "close_conversation", "remove_post"]), note: z.string().max(500).optional() }));
  await moderate(ctx.user.id, id, b.action, b.note);
  return json({ status: "done" });
});
