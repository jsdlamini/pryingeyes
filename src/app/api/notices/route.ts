import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { listNotices } from "@/lib/notices";

/** Recent non-expired public notices from the bot's official boards, for the dashboard. */
export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  return json({ notices: await listNotices(ctx.user.id) });
});
