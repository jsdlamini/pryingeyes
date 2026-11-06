import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser, requireRole } from "@/lib/auth";
import { listUsers, directAdminAction, AdminAction } from "@/lib/admin";

export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  requireRole(ctx, "admin");
  return json({ users: await listUsers() });
});

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  requireRole(ctx, "admin");
  const b = await readJson(req, z.object({ request: AdminAction, reason: z.string().max(500) }));
  return json(await directAdminAction(ctx.user.id, b.request, b.reason));
});
