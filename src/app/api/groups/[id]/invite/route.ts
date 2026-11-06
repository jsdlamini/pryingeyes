import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { resetInvite } from "@/lib/social";
import { uuid } from "@/lib/social-http";

/** Makes a new invite link; the old one stops working. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  return json(await resetInvite(ctx.user.id, uuid(id)));
});
