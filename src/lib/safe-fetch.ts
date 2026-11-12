/**
 * Fetching a page someone pasted, without letting them point the server at itself or its network
 * (SSRF). Every address a host name resolves to is checked when the connection is made (not in a
 * separate lookup first), so a name can't switch to an inside address in between. Redirects are
 * followed by hand, at most three, and each hop is checked again. Bodies are capped.
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const blocked = new net.BlockList();
for (const [a, p] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4], ["255.255.255.255", 32],
] as const) blocked.addSubnet(a, p, "ipv4");
for (const [a, p] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(a, p, "ipv6");

/** True for loopback, private, link-local, carrier-grade NAT, documentation, multicast and mapped addresses. */
export function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);   // IPv4-mapped: judge the IPv4 address
    return mapped ? isBlockedAddress(mapped[1]) : blocked.check(ip, "ipv6");
  }
  return true;
}

export class UnsafeTarget extends Error {}

/** A dns.lookup that refuses names resolving to an inside address. */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return (callback as (e: Error | null, a: string, f: number) => void)(err, "", 0);
    const list = addresses as unknown as dns.LookupAddress[];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad || !list.length) return (callback as (e: Error | null, a: string, f: number) => void)(new UnsafeTarget(`blocked address for ${hostname}`), "", 0);
    if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    return (callback as (e: null, a: string, f: number) => void)(null, list[0].address, list[0].family);
  });
};

export type SafeResponse = { status: number; url: string; contentType: string; body: string };

function once(url: URL, timeoutMs: number, maxBytes: number, accept: RegExp): Promise<{ status: number; location?: string; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, "")) && isBlockedAddress(url.hostname.replace(/^\[|\]$/g, ""))) return reject(new UnsafeTarget("blocked address"));
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.get(url, {
      lookup: guardedLookup, timeout: timeoutMs, agent: false,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PryingEyesPreview/1.0)", Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const contentType = String(res.headers["content-type"] ?? "");
      if (status >= 300 && status < 400 && res.headers.location) { res.resume(); return resolve({ status, location: res.headers.location, contentType, body: "" }); }
      if (!accept.test(contentType)) { res.resume(); return resolve({ status, contentType, body: "" }); }
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) { chunks.push(c.subarray(0, Math.max(0, c.length - (size - maxBytes)))); res.destroy(); return; }
        chunks.push(c);
      });
      res.on("close", () => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

/** GET an http(s) page safely. Throws UnsafeTarget for inside addresses; other errors for network trouble. */
export async function safeFetchHtml(raw: string, { timeoutMs = 4000, maxBytes = 256 * 1024, maxRedirects = 3, accept = /text\/html|application\/xhtml/i } = {}): Promise<SafeResponse> {
  let url = new URL(raw);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeTarget("scheme");
    if (url.username || url.password) throw new UnsafeTarget("credentials in URL");
    if (url.port && !["80", "443", "8080", "8443"].includes(url.port)) throw new UnsafeTarget("port");
    const r = await once(url, timeoutMs, maxBytes, accept);
    if (r.location) { url = new URL(r.location, url); continue; }
    return { status: r.status, url: url.toString(), contentType: r.contentType, body: r.body };
  }
  throw new UnsafeTarget("too many redirects");
}
