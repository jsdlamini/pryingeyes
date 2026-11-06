import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { createPost, statusFeed } from "@/lib/social";
import { authorFor, PostBody } from "@/lib/social-http";

export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  return json({ people: await statusFeed(ctx.user.id) });
});

export const POST = route(async (req) => {
  const b = await readJson(req, PostBody);
  const ctx = await authorFor(req, b.attach);
  return json(await createPost(ctx.user.id, { groupId: null, text: b.text, attach: b.attach }), 201);
});
