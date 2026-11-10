import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { safetyNumber } from "@/lib/chat";
import { uuid } from "@/lib/social-http";

export const GET = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  return json(await safetyNumber(ctx.user.id, uuid(id)));
});
