import { route, json } from "@/lib/http";
import { requireUser, ownerChecklist } from "@/lib/auth";
import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { accountSummary } from "@/lib/accounts";
import { hasCode } from "@/lib/growth";
import { maybeRefreshHomeCountry, placesFromRequest } from "@/lib/places";

export const GET = route(async (req) => {
  const ctx = await requireUser(req, { allowMfaPending: true, allowPending: true });
  const seen = placesFromRequest(req).country;
  await maybeRefreshHomeCountry(ctx.user.id, seen);
  const me = await accountSummary(ctx.user.id);
  return json({
    user: { ...me, hasCode: await hasCode(ctx.user.id), loopPrompt: (await db().select({ lp: schema.users.loopPrompt }).from(schema.users).where(eq(schema.users.id, ctx.user.id)))[0]?.lp ?? null },
    session: { mfaPending: ctx.session.mfaPending, mfaAt: ctx.session.mfaAt },
    owner: await ownerChecklist(ctx),
    // Protected phone numbers are optional: without any, codes are app-only (message and in-app call).
    numbers: (await db().select({ c: count() }).from(schema.phoneNumbers)
      .where(and(eq(schema.phoneNumbers.userId, ctx.user.id), eq(schema.phoneNumbers.kind, "protected"))))[0].c,
    // The detected country, surfaced only when it differs from the chosen home (travel suggestion).
    travel: seen !== me.homeCountry ? seen : null,
  });
});
