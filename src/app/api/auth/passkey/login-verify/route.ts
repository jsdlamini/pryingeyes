import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { sessionFromRequest, markMfa } from "@/lib/session";
import { verifyAuthentication } from "@/lib/webauthn";
import { startSession } from "@/lib/login";
import { forbidden } from "@/lib/errors";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export const POST = route(async (req) => {
  const { ceremonyId, response } = await readJson(req, z.object({ ceremonyId: z.string().max(64), response: z.any() }));
  const ctx = await sessionFromRequest(req);
  const userId = await verifyAuthentication(ceremonyId, response);
  if (ctx && ctx.user.id === userId) {
    await markMfa(ctx.session.id);
    return json({ status: "verified" });
  }
  const [u] = await db().select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u || u.status === "suspended") throw forbidden("account_suspended", "This account is suspended.");
  return startSession(req, userId, "passkey", { mfaSatisfied: true });
});
