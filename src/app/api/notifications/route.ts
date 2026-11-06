import { and, desc, eq, isNull } from "drizzle-orm";
import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db, schema } from "@/db";
import { unreadTotal } from "@/lib/chat";

export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  const rows = await db().select().from(schema.notifications).where(eq(schema.notifications.userId, ctx.user.id))
    .orderBy(desc(schema.notifications.createdAt)).limit(50);
  return json({ notifications: rows.map(({ userId: _u, ...r }) => r), unread: rows.filter((r) => !r.readAt).length,
    chatsUnread: await unreadTotal(ctx.user.id) });
});

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  await db().update(schema.notifications).set({ readAt: new Date() })
    .where(and(eq(schema.notifications.userId, ctx.user.id), isNull(schema.notifications.readAt)));
  return json({ status: "read" });
});
