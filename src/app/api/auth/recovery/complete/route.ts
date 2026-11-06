import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { recoveryComplete } from "@/lib/accounts";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export const POST = route(async (req) => {
  const ctx = await requireUser(req, { allowMfaPending: true });
  await recoveryComplete(ctx.user.id);
  // Session continues without a second factor; owner features stay locked until one is enrolled.
  await db().update(schema.sessions).set({ mfaPending: false, mfaAt: null }).where(eq(schema.sessions.id, ctx.session.id));
  return json({ status: "completed" });
});
