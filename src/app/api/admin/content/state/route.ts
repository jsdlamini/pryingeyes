import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser, requireRole } from "@/lib/auth";
import { botState, setPaused } from "@/lib/content";

const Body = z.object({ paused: z.boolean() });

export const GET = route(async (req) => {
  const ctx = await requireUser(req); requireRole(ctx, "admin");
  return json({ state: await botState() });
});
export const POST = route(async (req) => {
  const ctx = await requireUser(req); requireRole(ctx, "admin");
  const b = await readJson(req, Body);
  return json({ state: await setPaused(b.paused) });
});
