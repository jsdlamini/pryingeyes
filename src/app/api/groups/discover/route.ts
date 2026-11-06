import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { discoverGroups } from "@/lib/social";

/** Listed groups matching ?q= (name or description). Anyone signed in can look, then ask to join. */
export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  return json({ groups: await discoverGroups(ctx.user.id, new URL(req.url).searchParams.get("q") ?? "") });
});
