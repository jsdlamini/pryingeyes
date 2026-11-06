import { env } from "./env";

/** Token the development CAPTCHA widget produces. Rejected outright in production. */
export const DEV_CAPTCHA_TOKEN = "dev-human-check-passed";

export async function verifyCaptcha(token: string | undefined | null, ip: string): Promise<boolean> {
  if (!token || token.length > 4096) return false;
  const e = env();
  if (e.CAPTCHA_PROVIDER === "dev") return e.APP_ENV !== "production" && token === DEV_CAPTCHA_TOKEN;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: e.TURNSTILE_SECRET, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false; // fail closed
  }
}
