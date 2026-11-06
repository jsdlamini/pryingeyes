import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { cancelRequest, requestToJoin } from "@/lib/social";
import { uuid } from "@/lib/social-http";

/** Ask to join a listed group (an admin approves), or withdraw the request with { cancel: true }. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, z.object({ note: z.string().max(400).optional(), cancel: z.boolean().optional() }));
  if (b.cancel) { await cancelRequest(ctx.user.id, uuid(id)); return json({ status: "cancelled" }); }
  return json(await requestToJoin(ctx.user.id, uuid(id), b.note));
});
