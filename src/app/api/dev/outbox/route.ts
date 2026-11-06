import { desc } from "drizzle-orm";
import { route, json } from "@/lib/http";
import { env } from "@/lib/env";
import { db, schema } from "@/db";
import { notFound } from "@/lib/errors";

/** Development only: messages the app would have sent (SMS, email, voice). */
export const GET = route(async () => {
  if (env().APP_ENV === "production") throw notFound();
  const rows = await db().select().from(schema.devOutbox).orderBy(desc(schema.devOutbox.createdAt)).limit(50);
  return json({ messages: rows });
});
