import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { consumeMessage } from "@/lib/chat";
import { uuid } from "@/lib/social-http";

export const POST = route<{ id: string; messageId: string }>(async (req, { id, messageId }) => {
  const ctx = await requireUser(req);
  return json(await consumeMessage(ctx.user.id, uuid(id), uuid(messageId)));
});
