import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { deletePost } from "@/lib/social";
import { uuid } from "@/lib/social-http";

export const DELETE = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  await deletePost(ctx.user.id, uuid(id));
  return json({ status: "deleted" });
});
