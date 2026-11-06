import { route, json } from "@/lib/http";
import { env } from "@/lib/env";

/** Public client settings for the phone app (no secrets). */
export const GET = route(async () => {
  const e = env();
  return json({
    appUrl: e.APP_URL,
    appDownloadUrl: e.APP_DOWNLOAD_URL || null,
    captchaMode: e.CAPTCHA_PROVIDER,
    turnstileSiteKey: e.CAPTCHA_PROVIDER === "turnstile" ? e.TURNSTILE_SITE_KEY : null,
    devTools: e.APP_ENV !== "production",
    defaultCountry: e.DEFAULT_COUNTRY,
  });
});
