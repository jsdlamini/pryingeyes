import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser, requireRole, requireStepUp } from "@/lib/auth";
import { decideAdminAction } from "@/lib/admin";
import { notFound } from "@/lib/errors";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  requireRole(ctx, "admin");
  requireStepUp(ctx, 15);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const { approve } = await readJson(req, z.object({ approve: z.boolean() }));
  return json(await decideAdminAction(ctx.user.id, id, approve));
});
