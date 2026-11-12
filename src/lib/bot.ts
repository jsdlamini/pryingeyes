import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const BOT_HANDLE = "pryingeyes_bot";

/** The bot account that owns official notice boards and posts to them. Created on first use. */
export async function botAccountId(): Promise<string> {
  const [u] = await db().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.handle, BOT_HANDLE));
  if (u) return u.id;
  const [created] = await db().insert(schema.users).values({
    handle: BOT_HANDLE, email: "bot@pryingeyes.local", status: "active",
    roles: ["content_moderator"], ageConfirmedAt: new Date(), emailVerifiedAt: new Date(),
  }).returning();
  return created.id;
}
