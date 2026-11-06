import { env } from "@/lib/env";

/** Android App Links: lets the app open https://<host>/t/… and /g/… links directly. */
export const dynamic = "force-dynamic";
export function GET() {
  const fps = env().ANDROID_CERT_SHA256.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const body = fps.length ? [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: env().ANDROID_PACKAGE, sha256_cert_fingerprints: fps },
  }] : [];
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } });
}
