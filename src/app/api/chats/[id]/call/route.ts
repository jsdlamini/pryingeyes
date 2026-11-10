import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { startChatCall } from "@/lib/calls";
import { participantConv } from "@/lib/chat";
import { uuid } from "@/lib/social-http";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  const c = await participantConv(ctx.user.id, uuid(id));
  const calleeId = c.callerId === ctx.user.id ? c.ownerId : c.callerId;
  return json(await startChatCall({ caller: ctx.user, calleeId, label: c.label }));
});
