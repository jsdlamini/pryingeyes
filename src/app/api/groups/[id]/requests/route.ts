import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { decideJoin, joinRequests } from "@/lib/social";
import { uuid } from "@/lib/social-http";

/** Join requests for the group's creator and admins: list, then approve or decline. */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  return json({ requests: await joinRequests(ctx.user.id, uuid(id)) });
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, z.object({ userId: z.string().uuid(), decision: z.enum(["approve", "decline"]) }));
  return json(await decideJoin(ctx.user.id, uuid(id), b.userId, b.decision === "approve"));
});
