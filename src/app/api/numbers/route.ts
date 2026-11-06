import { z } from "zod";
import { and, eq, inArray, count } from "drizzle-orm";
import { route, json, readJson } from "@/lib/http";
import { requireOwner } from "@/lib/auth";
import { storeNumber } from "@/lib/vault";
import { audit } from "@/lib/audit";
import { db, schema } from "@/db";
import { conflict } from "@/lib/errors";

export const GET = route(async (req) => {
  const ctx = await requireOwner(req);
  const rows = await db().select({ id: schema.phoneNumbers.id, hint: schema.phoneNumbers.hint, label: schema.phoneNumbers.label,
    country: schema.phoneNumbers.country, createdAt: schema.phoneNumbers.createdAt })
    .from(schema.phoneNumbers).where(and(eq(schema.phoneNumbers.userId, ctx.user.id), eq(schema.phoneNumbers.kind, "protected")));
  const out = [];
  for (const r of rows) {
    const [{ c }] = await db().select({ c: count() }).from(schema.tokens)
      .where(and(eq(schema.tokens.numberId, r.id), inArray(schema.tokens.status, ["active", "paused", "frozen"])));
    out.push({ ...r, activeTokens: c });
  }
  return json({ numbers: out });
});

export const POST = route(async (req) => {
  const ctx = await requireOwner(req);
  const b = await readJson(req, z.object({ phone: z.string().max(32), country: z.string().length(2).nullable().optional(), label: z.string().max(60).default("") }));
  const [{ c }] = await db().select({ c: count() }).from(schema.phoneNumbers)
    .where(and(eq(schema.phoneNumbers.userId, ctx.user.id), eq(schema.phoneNumbers.kind, "protected")));
  if (c >= 5) throw conflict("number_cap", "You can protect up to 5 numbers.");
  const n = await storeNumber(ctx.user.id, b.phone, "protected", b.label, undefined, b.country);
  await audit({ type: "number.added", actorId: ctx.user.id, ownerId: ctx.user.id, subjectType: "number", subjectId: n.id });
  return json({ id: n.id, hint: n.hint, country: n.country }, 201);
});
