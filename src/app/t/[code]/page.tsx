import { env } from "@/lib/env";
import { currentAuth } from "@/lib/server-auth";
import { Gate } from "@/components/Gate";
import { OpenInApp } from "@/components/OpenInApp";

export const metadata = { title: "Reach someone", referrer: "no-referrer" };

export default async function TokenPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const a = await currentAuth();
  const e = env();
  return (
    <div className="narrow">
      <OpenInApp path={`t/${code}`} downloadUrl={e.APP_DOWNLOAD_URL || null} />
      <Gate code={decodeURIComponent(code)} signedIn={!!a && !a.session.mfaPending} handle={a?.user.handle ?? null}
        captchaMode={e.CAPTCHA_PROVIDER} siteKey={e.TURNSTILE_SITE_KEY} />
    </div>
  );
}
