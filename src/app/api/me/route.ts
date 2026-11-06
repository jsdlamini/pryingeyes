import { route, json } from "@/lib/http";
import { requireUser, ownerChecklist } from "@/lib/auth";
import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { accountSummary } from "@/lib/accounts";

export const GET = route(async (req) => {
  const ctx = await requireUser(req, { allowMfaPending: true, allowPending: true });
  return json({
    user: await accountSummary(ctx.user.id),
    session: { mfaPending: ctx.session.mfaPending, mfaAt: ctx.session.mfaAt },
    owner: await ownerChecklist(ctx),
    // Protected phone numbers are optional: without any, codes are app-only (message and in-app call).
    numbers: (await db().select({ c: count() }).from(schema.phoneNumbers)
      .where(and(eq(schema.phoneNumbers.userId, ctx.user.id), eq(schema.phoneNumbers.kind, "protected"))))[0].c,
  });
});
