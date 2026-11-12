import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser, requireRole } from "@/lib/auth";
import { listItems, setItemStatus } from "@/lib/content";

const Patch = z.object({ id: z.string().uuid(), status: z.enum(["discarded", "new"]) });

export const GET = route(async (req) => {
  const ctx = await requireUser(req); requireRole(ctx, "admin");
  const q = new URL(req.url).searchParams;
  return json({ items: await listItems(q.get("status") ?? undefined, Number(q.get("limit") ?? 100)) });
});
export const PATCH = route(async (req) => {
  const ctx = await requireUser(req); requireRole(ctx, "admin");
  const b = await readJson(req, Patch);
  return json({ item: await setItemStatus(b.id, b.status) });
});
