import { audit } from "./audit";
import { createSession, deviceUa, isMobileClient, sessionCookie } from "./session";
import { clientIp, json } from "./http";
import { hasMfa } from "./auth";

/** Issues a session after first-factor or passkey sign-in. MFA users get an "MFA pending" session. */
export async function startSession(req: Request, userId: string, method: string, opts: { mfaSatisfied?: boolean } = {}) {
  const mfaNeeded = !opts.mfaSatisfied && (await hasMfa(userId));
  const mobile = isMobileClient(req);
  const secret = await createSession(userId, mobile ? deviceUa(req) : req.headers.get("user-agent") ?? "", {
    mfa: !!opts.mfaSatisfied, mfaPending: mfaNeeded,
  });
  await audit({ type: "account.login", actorId: userId, ownerId: userId, payload: { method, mfaPending: mfaNeeded } });
  void clientIp;
  const status = mfaNeeded ? "mfa_required" : "signed_in";
  // The app keeps the token in the phone's secure storage and sends it as a bearer token.
  if (mobile) return json({ status, sessionToken: secret });
  return json({ status }, 200, { "Set-Cookie": sessionCookie(secret) });
}
