import { and, count, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { sessionFromRequest, type Session, type User } from "./session";
import { forbidden, unauthorized } from "./errors";

export interface AuthCtx { session: Session; user: User }

export async function hasMfa(userId: string): Promise<boolean> {
  const [t] = await db().select({ c: count() }).from(schema.totpSecrets)
    .where(and(eq(schema.totpSecrets.userId, userId), isNotNull(schema.totpSecrets.confirmedAt)));
  if (t.c > 0) return true;
  const [p] = await db().select({ c: count() }).from(schema.passkeys).where(eq(schema.passkeys.userId, userId));
  return p.c > 0;
}

/** Any signed-in user (callers included). A session still waiting for its MFA step is refused. */
export async function requireUser(req: Request, opts: { allowMfaPending?: boolean; allowPending?: boolean } = {}): Promise<AuthCtx> {
  const ctx = await sessionFromRequest(req);
  if (!ctx) throw unauthorized();
  if (ctx.session.mfaPending && !opts.allowMfaPending) throw unauthorized("mfa_required", "Finish signing in with your second factor.");
  if (ctx.user.status !== "active" && !opts.allowPending) throw forbidden("verification_required", "Verify your email or phone first.");
  return ctx;
}

export interface OwnerChecklist { verified: boolean; ageConfirmed: boolean; password: boolean; mfa: boolean; sessionMfa: boolean }

export async function ownerChecklist(ctx: AuthCtx): Promise<OwnerChecklist> {
  return {
    verified: ctx.user.status === "active",
    ageConfirmed: !!ctx.user.ageConfirmedAt,
    password: !!ctx.user.passwordHash,
    mfa: await hasMfa(ctx.user.id),
    sessionMfa: !!ctx.session.mfaAt,
  };
}

/**
 * Code owners: anyone verified and 18+ can create app-only codes, take requests and see their
 * activity. No phone number is involved, so no second factor is required.
 */
export async function requireCodeOwner(req: Request): Promise<AuthCtx> {
  const ctx = await requireUser(req);
  if (!ctx.user.ageConfirmedAt) throw forbidden("age_required", "Confirm you're 18 or older first.");
  return ctx;
}

/**
 * Number owners (store a phone number, or issue a code that can show or ring it): verified, 18+,
 * MFA enrolled and used this session (rule 1).
 */
export async function requireOwner(req: Request): Promise<AuthCtx> {
  const ctx = await requireUser(req);
  const c = await ownerChecklist(ctx);
  if (!c.verified || !c.ageConfirmed || !c.mfa) throw forbidden("owner_setup_required", "Set up two-step sign-in before adding a phone number.");
  if (!c.sessionMfa) throw forbidden("step_up_required", "Confirm it's you with your passkey or authenticator code.");
  return ctx;
}

/** Recent second-factor confirmation, for sensitive actions. */
export function requireStepUp(ctx: AuthCtx, maxAgeMin = 10, notBefore?: Date | null) {
  const at = ctx.session.mfaAt?.getTime() ?? 0;
  if (Date.now() - at > maxAgeMin * 60_000 || (notBefore && at < notBefore.getTime()))
    throw forbidden("step_up_required", "Confirm it's you with your passkey or authenticator code.");
}

export function requireRole(ctx: AuthCtx, role: "moderator" | "admin") {
  if (!ctx.user.roles.includes(role) && !(role === "moderator" && ctx.user.roles.includes("admin")))
    throw forbidden("forbidden", "You don't have access to this area.");
}
