import { route, json } from "@/lib/http";
import { requireUser, requireRole } from "@/lib/auth";
import { tickContentBot, botState } from "@/lib/content";

/** Admin-only: run the bot loop now (fetch due sources and extract queued items). */
export const POST = route(async (req) => {
  const ctx = await requireUser(req); requireRole(ctx, "admin");
  const run = await tickContentBot(true);
  return json({ run, state: await botState() });
});
