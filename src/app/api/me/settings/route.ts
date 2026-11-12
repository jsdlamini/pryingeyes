import { z } from "zod";
import { eq } from "drizzle-orm";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/db";
import { ownUpload } from "@/lib/uploads";

const Body = z.object({ auditRetentionMonths: z.number().int().min(1).max(24).optional(), readReceipts: z.boolean().optional(), doNotDisturb: z.boolean().optional(), shareCodeByDefault: z.boolean().optional(), avatarUrl: z.string().regex(/^\/uploads\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/).nullable().optional(), homeCountry: z.string().length(2).optional(), homeRegion: z.string().max(40).nullable().optional(), placesSource: z.enum(["detected", "chosen"]).optional(), extraCountries: z.array(z.string().length(2)).max(3).optional() });

export const PATCH = route(async (req) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, Body);
  if (b.avatarUrl) await ownUpload(ctx.user.id, b.avatarUrl, ["jpg", "png", "webp", "gif"]); // only your own photo
  await db().update(schema.users).set(b).where(eq(schema.users.id, ctx.user.id));
  return json({ status: "saved" });
});
