import { describe, expect, it } from "vitest";
import { isBlockedAddress, safeFetchHtml, UnsafeTarget } from "@/lib/safe-fetch";

describe("isBlockedAddress", () => {
  it("blocks loopback and private ranges", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("10.0.0.5")).toBe(true);
    expect(isBlockedAddress("172.16.5.5")).toBe(true);
    expect(isBlockedAddress("192.168.1.1")).toBe(true);
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("0.0.0.0")).toBe(true);
  });
  it("blocks IPv6 loopback, link-local, unique-local and mapped IPv4", () => {
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
    expect(isBlockedAddress("fc00::1")).toBe(true);
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
  });
  it("allows public addresses", () => {
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("1.1.1.1")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });
});

describe("safeFetchHtml SSRF guard", () => {
  it("refuses a literal loopback address", async () => {
    await expect(safeFetchHtml("http://127.0.0.1/")).rejects.toBeInstanceOf(UnsafeTarget);
  });
  it("refuses localhost (resolves to loopback)", async () => {
    await expect(safeFetchHtml("http://localhost/")).rejects.toBeInstanceOf(UnsafeTarget);
  });
  it("refuses non-http schemes", async () => {
    await expect(safeFetchHtml("file:///etc/passwd")).rejects.toBeInstanceOf(UnsafeTarget);
  });
  it("refuses credentials in the URL", async () => {
    await expect(safeFetchHtml("https://user:pass@example.com/")).rejects.toBeInstanceOf(UnsafeTarget);
  });
});
