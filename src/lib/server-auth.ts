import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cookieName, loadSession } from "./session";

/** Session lookup for server components. */
export async function currentAuth() {
  const c = await cookies();
  const h = await headers();
  return loadSession(c.get(cookieName())?.value ?? null, h.get("user-agent") ?? "");
}

export async function requirePageAuth(next: string) {
  const a = await currentAuth();
  if (!a) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (a.session.mfaPending) redirect(`/login/mfa?next=${encodeURIComponent(next)}`);
  return a;
}
