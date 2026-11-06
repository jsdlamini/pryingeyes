import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser, requireRole, requireStepUp } from "@/lib/auth";
import { AdminAction, listAdminActions, requestAdminAction } from "@/lib/admin";

export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  requireRole(ctx, "admin");
  return json({ actions: await listAdminActions() });
});

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  requireRole(ctx, "admin");
  requireStepUp(ctx, 15);
  const b = await readJson(req, z.object({ request: AdminAction, reason: z.string().max(500) }));
  const a = await requestAdminAction(ctx.user.id, b.request, b.reason);
  return json({ id: a.id, status: a.status }, 201);
});
