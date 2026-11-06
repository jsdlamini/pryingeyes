import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { leaveGroup } from "@/lib/social";
import { uuid } from "@/lib/social-http";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  await leaveGroup(ctx.user.id, uuid(id));
  return json({ status: "left" });
});
