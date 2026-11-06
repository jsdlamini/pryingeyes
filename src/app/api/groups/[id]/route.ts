import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { groupDetail, updateGroup } from "@/lib/social";
import { uuid } from "@/lib/social-http";

export const GET = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  return json({ group: await groupDetail(ctx.user.id, uuid(id)) });
});

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, z.object({ name: z.string().max(200).optional(), about: z.string().max(2000).optional(), listed: z.boolean().optional() }));
  await updateGroup(ctx.user.id, uuid(id), b);
  return json({ group: await groupDetail(ctx.user.id, id) });
});
