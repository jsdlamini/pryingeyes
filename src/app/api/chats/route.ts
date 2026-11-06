import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { listConversations } from "@/lib/chat";

export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  return json({ conversations: await listConversations(ctx.user.id) });
});
