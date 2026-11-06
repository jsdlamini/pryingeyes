import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { incomingFor } from "@/lib/calls";

/** Polled by the open app every few seconds: is someone calling me right now? */
export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  return json({ call: await incomingFor(ctx.user.id) });
});
