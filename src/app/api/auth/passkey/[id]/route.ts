import { and, count, eq, isNotNull } from "drizzle-orm";
import { route, json } from "@/lib/http";
import { requireUser, requireStepUp } from "@/lib/auth";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/errors";

export const DELETE = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  requireStepUp(ctx);
  const [pk] = await db().select({ c: count() }).from(schema.passkeys).where(eq(schema.passkeys.userId, ctx.user.id));
  const [t] = await db().select({ c: count() }).from(schema.totpSecrets)
    .where(and(eq(schema.totpSecrets.userId, ctx.user.id), isNotNull(schema.totpSecrets.confirmedAt)));
  if (pk.c <= 1 && t.c === 0) throw badRequest("last_factor", "Add another passkey or an authenticator app before removing this one.");
  const r = await db().delete(schema.passkeys).where(and(eq(schema.passkeys.id, decodeURIComponent(id)), eq(schema.passkeys.userId, ctx.user.id)));
  if ((r.rowCount ?? 0) > 0) await audit({ type: "account.passkey_removed", actorId: ctx.user.id, ownerId: ctx.user.id });
  return json({ status: "removed" });
});
