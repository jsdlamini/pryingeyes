import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { randomCrockford, normaliseCrockford, isCrockford, aesGcmEncrypt, aesGcmDecrypt, CROCKFORD } from "@/lib/crypto";
import { redactString, redactValue, containsPhoneShape } from "@/lib/redact";
import { base32Decode, base32Encode, hotp, verifyTotp, totpAt, newTotpSecret, stepAt } from "@/lib/totp";
import { LocalKeyProvider } from "@/lib/keys";
import { canonical } from "@/lib/audit";

describe("Crockford tokens", () => {
  it("produces the requested length from the Crockford alphabet only", () => {
    for (let i = 0; i < 500; i++) {
      const t = randomCrockford(16);
      expect(t).toHaveLength(16);
      expect(isCrockford(t)).toBe(true);
      expect(t).not.toMatch(/[ILOU]/);
    }
  });
  it("is close to uniform across the alphabet (no modulo bias)", () => {
    const counts = new Map<string, number>();
    const N = 200_000;
    const s = randomCrockford(N);
    for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(32);
    const expected = N / 32;
    // chi-square with 31 dof; p=0.001 critical value ≈ 61.1
    let chi = 0;
    for (const ch of CROCKFORD) chi += ((counts.get(ch) ?? 0) - expected) ** 2 / expected;
    expect(chi).toBeLessThan(61.1);
  });
  it("has no collisions across 100k draws of 80-bit tokens", () => {
    const set = new Set<string>();
    for (let i = 0; i < 100_000; i++) set.add(randomCrockford(16));
    expect(set.size).toBe(100_000);
  });
  it("normalises human input", () => {
    expect(normaliseCrockford("k7qm-4xr2 9bdn.2f9o")).toBe("K7QM4XR29BDN2F90");
    expect(normaliseCrockford("il")).toBe("11");
  });
});

describe("AES-256-GCM", () => {
  const key = crypto.randomBytes(32);
  it("round-trips and binds additional data", () => {
    const blob = aesGcmEncrypt(key, Buffer.from("hello"), Buffer.from("ctx-a"));
    expect(aesGcmDecrypt(key, blob, Buffer.from("ctx-a")).toString()).toBe("hello");
    expect(() => aesGcmDecrypt(key, blob, Buffer.from("ctx-b"))).toThrow();
  });
  it("detects tampering", () => {
    const blob = aesGcmEncrypt(key, Buffer.from("hello"));
    blob[blob.length - 1] ^= 1;
    expect(() => aesGcmDecrypt(key, blob)).toThrow();
  });
  it("uses a fresh IV every time", () => {
    const a = aesGcmEncrypt(key, Buffer.from("same")), b = aesGcmEncrypt(key, Buffer.from("same"));
    expect(a.equals(b)).toBe(false);
  });
});

describe("KeyProvider (envelope encryption)", () => {
  it("wraps/unwraps and supports KEK rotation", async () => {
    const v1 = crypto.randomBytes(32), v2 = crypto.randomBytes(32);
    const p1 = new LocalKeyProvider({ version: 1, key: v1 });
    const dk = crypto.randomBytes(32);
    const w = await p1.wrap(dk, "user:a");
    expect((await p1.unwrap(w.wrapped, 1, "user:a")).equals(dk)).toBe(true);
    await expect(p1.unwrap(w.wrapped, 1, "user:b")).rejects.toThrow();
    const p2 = new LocalKeyProvider({ version: 2, key: v2 }, { 1: v1.toString("base64") });
    expect((await p2.unwrap(w.wrapped, 1, "user:a")).equals(dk)).toBe(true);
    expect((await p2.wrap(dk, "user:a")).version).toBe(2);
  });
});

describe("Log redaction", () => {
  it("removes phone-number shapes in many formats", () => {
    for (const n of ["+26876123456", "+268 7612 3456", "(076) 123-4567", "076.123.4567", "0761234567", "+1 (415) 555-0100"]) {
      expect(redactString(`call ${n} now`)).not.toContain(n);
      expect(containsPhoneShape(n)).toBe(true);
    }
  });
  it("leaves database and ISO timestamps alone but still catches numbers next to them", () => {
    const s = "at 2026-11-03T14:52:13.648123+00:00 and 2026-11-03 14:52:13.648123 then +26876123456";
    expect(redactString(s)).toBe("at 2026-11-03T14:52:13.648123+00:00 and 2026-11-03 14:52:13.648123 then [redacted-number]");
    expect(containsPhoneShape("2026-11-03T14:52:13.648123Z")).toBe(false);
  });
  it("keeps ordinary values", () => {
    const s = "user 3f2b1c9a-1111-4222-8333-444455556666 at 2026-11-03T10:00:00Z took 241ms";
    expect(redactString(s)).toBe(s);
  });
  it("redacts sensitive keys and nested values", () => {
    const v = redactValue({ password: "x", nested: { msg: "ring +26878000111" }, list: ["+26879000222"] }) as any;
    expect(v.password).toBe("[redacted]");
    expect(JSON.stringify(v)).not.toMatch(/2687/);
  });
  it("redacts token paths", () => {
    expect(redactString("GET /t/K7QM4XR29BDN2F9X")).toBe("GET /t/[redacted-token]");
  });
});

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC 4226 HOTP test vectors", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(["755224", "287082", "359152", "969429", "338314"]).toEqual([0, 1, 2, 3, 4].map((c) => hotp(secret, c)));
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });
  it("accepts ±1 step and rejects replays", () => {
    const s = newTotpSecret();
    const now = Date.now();
    const code = totpAt(s, now);
    const step = verifyTotp(s, code, null, now);
    expect(step).toBe(stepAt(now));
    expect(verifyTotp(s, code, step, now)).toBeNull();
    expect(verifyTotp(s, totpAt(s, now - 30_000), null, now)).not.toBeNull();
    expect(verifyTotp(s, totpAt(s, now - 120_000), null, now)).toBeNull();
    expect(verifyTotp(s, "abc", null, now)).toBeNull();
  });
});

describe("canonical JSON", () => {
  it("is key-order independent", () => {
    expect(canonical({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(canonical({ a: [1, { c: 3, d: 2 }], b: 1 }));
  });
});
