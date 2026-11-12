import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser, requireRole } from "@/lib/auth";
import { listRoutes, setRoute, removeRoute, CONTENT_CATEGORIES } from "@/lib/content";

const Put = z.object({ country: z.string().length(2), category: z.enum(CONTENT_CATEGORIES), groupId: z.string().uuid() });

export const GET = route(async (req) => {
  const ctx = await requireUser(req); requireRole(ctx, "admin");
  return json({ routes: await listRoutes() });
});
export const PUT = route(async (req) => {
  const ctx = await requireUser(req); requireRole(ctx, "admin");
  const b = await readJson(req, Put);
  return json({ route: await setRoute(b.country, b.category, b.groupId) });
});
export const DELETE = route(async (req) => {
  const ctx = await requireUser(req); requireRole(ctx, "admin");
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return json(await removeRoute(id));
});
