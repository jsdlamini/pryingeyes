import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { createComment, listComments } from "@/lib/social";
import { uuid } from "@/lib/social-http";

export const GET = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  return json({ comments: await listComments(ctx.user.id, uuid(id)) });
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, z.object({ text: z.string().max(2000), parentId: z.string().uuid().nullable().optional(), attachment: z.string().regex(/^\/uploads\/[0-9a-f-]{36}\.(jpg|png|webp|gif|webm|m4a|mp3|ogg|mp4|mov|m4v)$/).nullable().optional() }));
  return json(await createComment(ctx.user.id, uuid(id), b.text, b.parentId, b.attachment), 201);
});
