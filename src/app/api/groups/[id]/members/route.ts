import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { manageMember } from "@/lib/social";
import { uuid } from "@/lib/social-http";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, z.object({ userId: z.string().uuid(), action: z.enum(["remove", "make_admin"]) }));
  await manageMember(ctx.user.id, uuid(id), b.userId, b.action);
  return json({ status: "done" });
});
