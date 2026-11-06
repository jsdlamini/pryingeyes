import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { blockInConversation } from "@/lib/chat";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  await blockInConversation(ctx.user.id, id);
  return json({ status: "blocked" });
});
