import { env } from "@/lib/env";
import { requirePageAuth } from "@/lib/server-auth";
import { Gate } from "@/components/Gate";

export const metadata = { title: "Your request" };

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await requirePageAuth(`/r/${id}`);
  const e = env();
  return <div className="narrow"><Gate requestId={id} signedIn handle={a.user.handle} captchaMode={e.CAPTCHA_PROVIDER} siteKey={e.TURNSTILE_SITE_KEY} /></div>;
}
