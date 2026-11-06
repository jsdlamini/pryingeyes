import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { createPost, groupPosts } from "@/lib/social";
import { authorFor, PostBody, uuid } from "@/lib/social-http";

export const GET = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  const before = new URL(req.url).searchParams.get("before");
  return json({ posts: await groupPosts(ctx.user.id, uuid(id), { before: before ? new Date(before) : undefined }) });
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  const b = await readJson(req, PostBody);
  const ctx = await authorFor(req, b.attach);
  return json(await createPost(ctx.user.id, { groupId: uuid(id), text: b.text, attach: b.attach }), 201);
});
