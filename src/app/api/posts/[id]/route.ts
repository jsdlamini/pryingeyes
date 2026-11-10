import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { deletePost, updatePost } from "@/lib/social";
import { uuid } from "@/lib/social-http";

export const DELETE = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  await deletePost(ctx.user.id, uuid(id));
  return json({ status: "deleted" });
});

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, z.object({ text: z.string().max(4000) }));
  return json(await updatePost(ctx.user.id, uuid(id), b.text));
});
