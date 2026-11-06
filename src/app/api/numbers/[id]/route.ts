import { and, eq } from "drizzle-orm";
import { route, json } from "@/lib/http";
import { requireOwner, requireStepUp } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { db, schema } from "@/db";
import { notFound } from "@/lib/errors";

/** Removes a protected number and (by cascade) every token for it. */
export const DELETE = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireOwner(req);
  requireStepUp(ctx, 30);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const r = await db().delete(schema.phoneNumbers)
    .where(and(eq(schema.phoneNumbers.id, id), eq(schema.phoneNumbers.userId, ctx.user.id), eq(schema.phoneNumbers.kind, "protected")));
  if (!r.rowCount) throw notFound("number_not_found", "Number not found.");
  await audit({ type: "number.removed", actorId: ctx.user.id, ownerId: ctx.user.id, subjectType: "number", subjectId: id });
  return json({ status: "removed" });
});
