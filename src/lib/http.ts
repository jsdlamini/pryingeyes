import { ZodError, type ZodTypeAny, type z } from "zod";
import { HttpError, forbidden, badRequest } from "./errors";
import { env } from "./env";
import { log } from "./log";

export const NO_STORE = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...headers },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    const headers: Record<string, string> = {};
    if (err.status === 429 && err.extra?.retryAfter) headers["Retry-After"] = String(err.extra.retryAfter);
    return json({ error: err.code, message: err.message, ...(err.extra ?? {}) }, err.status, headers);
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return json({ error: "invalid_input", message: first ? (first.path.length ? `${first.path.join(".")}: ${first.message}` : first.message) : "Invalid input." }, 400);
  }
  log.error({ err }, "unhandled error");
  return json({ error: "server_error", message: "Something went wrong. Please try again." }, 500);
}

type Ctx<P> = { params: Promise<P> };
type Handler<P> = (req: Request, params: P) => Promise<Response>;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Wraps a route handler: same-origin check on mutating requests (CSRF), uniform error handling.
 * Pass { skipOrigin: true } only for provider webhooks, which authenticate by secret instead.
 */
export function route<P = Record<string, string>>(fn: Handler<P>, opts: { skipOrigin?: boolean } = {}) {
  return async (req: Request, ctx?: Ctx<P>): Promise<Response> => {
    try {
      if (MUTATING.has(req.method) && !opts.skipOrigin) checkOrigin(req);
      const params = ctx?.params ? await ctx.params : ({} as P);
      return await fn(req, params);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function checkOrigin(req: Request) {
  // The phone app authenticates with a bearer token and never sends cookies, so there is no
  // ambient credential for a cross-site page to abuse. Browsers can't add this header cross-site
  // without a CORS preflight, which production never grants.
  if (req.headers.get("x-pe-client") === "mobile" && !req.headers.get("cookie")) return;
  const expected = new URL(env().APP_URL).origin;
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== expected) throw forbidden("bad_origin", "Cross-site request blocked.");
    return;
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw forbidden("bad_origin", "Cross-site request blocked.");
  if (!site) throw forbidden("bad_origin", "Missing Origin header.");
}

export async function readJson<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 64 * 1024) throw badRequest("too_large", "Request too large.");
  let body: unknown;
  try { body = await req.json(); } catch { throw badRequest("invalid_json", "Malformed request."); }
  return schema.parse(body);
}

/** Client IP: the TRUST_PROXY_HOPS-th address from the right of X-Forwarded-For. */
export function clientIp(req: Request): string {
  const hops = env().TRUST_PROXY_HOPS;
  const xff = req.headers.get("x-forwarded-for");
  if (xff && hops > 0) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const ip = parts[Math.max(0, parts.length - hops)];
    if (ip) return ip.replace(/^::ffff:/, "");
  }
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

/** Coarse location: country from an edge header if present (e.g. Cloudflare), else null. */
export function edgeCountry(req: Request): string | null {
  const c = req.headers.get("cf-ipcountry") ?? req.headers.get("x-vercel-ip-country") ?? req.headers.get("x-country");
  return c && /^[A-Z]{2}$/.test(c) && c !== "XX" ? c : null;
}

/** Runs fn and returns no sooner than `floorMs` after the start, success or failure (rule 7). */
export async function withFloor<T>(floorMs: number, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const wait = floorMs - (performance.now() - start);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
