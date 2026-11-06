import { NextResponse, type NextRequest } from "next/server";

/**
 * Security headers on every response. Strict CSP with a per-request nonce (Next.js applies it to
 * its own scripts). Turnstile's origin is allowed only when that CAPTCHA provider is configured.
 */
/**
 * Development only: lets the phone app's web build (Expo, e.g. http://localhost:8081) call the API
 * from another origin. Bearer tokens only; cookies are never allowed cross-origin.
 */
function devCors(req: NextRequest): Record<string, string> | null {
  if (process.env.APP_ENV !== "development" || !req.nextUrl.pathname.startsWith("/api/")) return null;
  const origin = req.headers.get("origin");
  const allowed = (process.env.MOBILE_DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin, Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-PE-Client, X-PE-Device",
    "Access-Control-Expose-Headers": "Retry-After", "Access-Control-Max-Age": "600",
  };
}

export function middleware(req: NextRequest) {
  const cors = devCors(req);
  if (cors && req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: cors });
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production"; // dev server needs eval + websockets for hot reload
  const https = (process.env.APP_URL ?? "").startsWith("https://");
  const turnstile = process.env.CAPTCHA_PROVIDER === "turnstile" ? " https://challenges.cloudflare.com" : "";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}${turnstile}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    `frame-src${turnstile || " 'none'"}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    https ? "upgrade-insecure-requests" : "",
  ].filter(Boolean).join("; ");

  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), payment=(), usb=()");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (https) res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  if (cors) for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
