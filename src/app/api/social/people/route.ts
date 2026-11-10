import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { discoverPeople } from "@/lib/social";

export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return json({ people: await discoverPeople(ctx.user.id, q) });
});
