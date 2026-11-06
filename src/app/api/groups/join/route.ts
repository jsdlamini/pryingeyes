import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { joinByInvite, previewInvite } from "@/lib/social";

/**
 * Invite links. The invite travels in the body, never the URL, so it stays out of access logs.
 * Joining always means asking: an admin approves.
 */
export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, z.object({ invite: z.string().max(200), preview: z.boolean().optional(), note: z.string().max(400).optional() }));
  return json(b.preview ? { group: await previewInvite(ctx.user.id, b.invite) } : await joinByInvite(ctx.user.id, b.invite, b.note));
});
