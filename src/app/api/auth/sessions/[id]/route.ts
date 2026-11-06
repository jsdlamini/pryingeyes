import { and, eq, like } from "drizzle-orm";
import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";

/** Remote sign-out. `id` is the 16-character prefix shown in the device list. */
export const DELETE = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  if (!/^[0-9a-f]{16}$/.test(id)) return json({ error: "not_found" }, 404);
  const r = await db().update(schema.sessions).set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.userId, ctx.user.id), like(schema.sessions.id, `${id}%`)));
  if ((r.rowCount ?? 0) > 0) await audit({ type: "account.session_revoked", actorId: ctx.user.id, ownerId: ctx.user.id });
  return json({ status: "revoked" });
});
