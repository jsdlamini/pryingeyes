import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser, requireRole } from "@/lib/auth";
import { addSource, updateSource, removeSource, listSources, CONTENT_CATEGORIES } from "@/lib/content";

const Add = z.object({
  name: z.string().min(1).max(80), url: z.string(), category: z.enum(CONTENT_CATEGORIES),
  country: z.string().length(2).optional(), mode: z.enum(["rules", "ai"]).optional(),
  rules: z.string().nullable().optional(), enabled: z.boolean().optional(), intervalHours: z.number().int().min(1).max(168).optional(),
});
const Update = z.object({
  id: z.string().uuid(), name: z.string().min(1).max(80).optional(), url: z.string().optional(),
  category: z.enum(CONTENT_CATEGORIES).optional(), country: z.string().length(2).optional(),
  mode: z.enum(["rules", "ai"]).optional(), rules: z.string().nullable().optional(),
  enabled: z.boolean().optional(), intervalHours: z.number().int().min(1).max(168).optional(),
});

export const GET = route(async (req) => {
  const ctx = await requireUser(req); requireRole(ctx, "admin");
  return json({ sources: await listSources() });
});
export const POST = route(async (req) => {
  const ctx = await requireUser(req); requireRole(ctx, "admin");
  const b = await readJson(req, Add);
  return json({ source: await addSource(b) });
});
export const PATCH = route(async (req) => {
  const ctx = await requireUser(req); requireRole(ctx, "admin");
  const { id, ...rest } = await readJson(req, Update);
  return json({ source: await updateSource(id, rest) });
});
export const DELETE = route(async (req) => {
  const ctx = await requireUser(req); requireRole(ctx, "admin");
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return json(await removeSource(id));
});
