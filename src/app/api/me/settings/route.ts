import { z } from "zod";
import { eq } from "drizzle-orm";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/db";

const Body = z.object({ auditRetentionMonths: z.number().int().min(1).max(24).optional(), readReceipts: z.boolean().optional() });

export const PATCH = route(async (req) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, Body);
  await db().update(schema.users).set(b).where(eq(schema.users.id, ctx.user.id));
  return json({ status: "saved" });
});
