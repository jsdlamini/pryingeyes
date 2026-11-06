import { desc, eq, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { totpAt } from "@/lib/totp";

type Handler = (req: Request, ctx?: { params: Promise<any> }) => Promise<Response>;
const BASE = "http://localhost:3100";

/** Calls Next.js route handlers directly, like a browser would (cookie jar, Origin, UA, IP). */
export class Client {
  cookie = "";
  constructor(public ua = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 vitest", public ip = "10.1.1.1") {}

  async call(handler: Handler, method: string, path: string, body?: unknown, params: Record<string, string> = {}, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = {
      origin: BASE, "user-agent": this.ua, "x-forwarded-for": this.ip, ...extra,
    };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await handler(new Request(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      { params: Promise.resolve(params) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const [pair] = setCookie.split(";");
      this.cookie = pair.endsWith("=") ? "" : pair;
    }
    const ct = res.headers.get("content-type") ?? "";
    const data = ct.includes("json") ? await res.json() : ct.startsWith("image/") || ct.includes("pdf") ? Buffer.from(await res.arrayBuffer()) : await res.text();
    return { status: res.status, body: data as any, headers: res.headers };
  }
  post = (h: Handler, path: string, body: unknown = {}, params?: Record<string, string>) => this.call(h, "POST", path, body, params);
  get = (h: Handler, path: string, params?: Record<string, string>) => this.call(h, "GET", path, undefined, params);
  patch = (h: Handler, path: string, body: unknown, params?: Record<string, string>) => this.call(h, "PATCH", path, body, params);
  del = (h: Handler, path: string, params?: Record<string, string>) => this.call(h, "DELETE", path, undefined, params);
}

/** Calls route handlers the way the PryingEyes phone app does: no cookies, no Origin, a bearer token. */
export class MobileClient {
  token = "";
  constructor(public device = "PryingEyes-Mobile/1.0 (Android 15)", public ip = "10.9.9.9") {}
  async call(handler: Handler, method: string, path: string, body?: unknown, params: Record<string, string> = {}, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { "x-pe-client": "mobile", "x-pe-device": this.device, "user-agent": "okhttp/4.12.0", "x-forwarded-for": this.ip, ...extra };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await handler(new Request(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve(params) });
    const data = (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : await res.text();
    if (data && typeof data === "object" && "sessionToken" in data) this.token = (data as any).sessionToken;
    return { status: res.status, body: data as any, headers: res.headers };
  }
  post = (h: Handler, path: string, body: unknown = {}, params?: Record<string, string>) => this.call(h, "POST", path, body, params);
  get = (h: Handler, path: string, params?: Record<string, string>) => this.call(h, "GET", path, undefined, params);
}

export async function lastOutbox(opts: { channel: "sms" | "email" | "voice"; to?: string; userId?: string }) {
  const conds = [eq(schema.devOutbox.channel, opts.channel)];
  if (opts.to) conds.push(eq(schema.devOutbox.to, opts.to));
  if (opts.userId) conds.push(eq(schema.devOutbox.userId, opts.userId));
  const [m] = await db().select().from(schema.devOutbox).where(and(...conds)).orderBy(desc(schema.devOutbox.createdAt)).limit(1);
  return m;
}
export const codeIn = (text: string) => text.match(/\b(\d{6})\b/)![1];
export const maskedTo = (e164: string) => `····${e164.slice(-2)}`;

/** Current TOTP code for a user whose secret was returned at setup. */
export const totpNow = (secret: string, offsetMs = 0) => totpAt(secret, Date.now() + offsetMs);
