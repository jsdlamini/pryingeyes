import { and, desc, eq, isNull, gt } from "drizzle-orm";
import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/db";

export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  const rows = await db().select({
    id: schema.sessions.id, deviceLabel: schema.sessions.deviceLabel, createdAt: schema.sessions.createdAt, lastSeenAt: schema.sessions.lastSeenAt,
  }).from(schema.sessions)
    .where(and(eq(schema.sessions.userId, ctx.user.id), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date())))
    .orderBy(desc(schema.sessions.lastSeenAt));
  return json({ sessions: rows.map((r) => ({ ...r, id: r.id.slice(0, 16), current: r.id === ctx.session.id })) });
});
