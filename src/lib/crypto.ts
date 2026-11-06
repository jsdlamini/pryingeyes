import crypto from "node:crypto";

/** Crockford Base32 alphabet: no I, L, O, U. */
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Random Crockford Base32 string with exactly `chars * 5` bits of CSPRNG entropy. */
export function randomCrockford(chars: number): string {
  let out = "";
  // Each byte supplies 8 bits; take 5 bits at a time without modulo bias.
  const bytes = crypto.randomBytes(Math.ceil((chars * 5) / 8) + 1);
  let acc = 0, bits = 0, i = 0;
  while (out.length < chars) {
    acc = (acc << 8) | bytes[i++];
    bits += 8;
    while (bits >= 5 && out.length < chars) {
      bits -= 5;
      out += CROCKFORD[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return out;
}

/** Normalise human input to canonical Crockford: strip separators, uppercase, map O→0, I/L→1. */
export function normaliseCrockford(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/U/g, "V");
}

export function isCrockford(s: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]+$/.test(s);
}

export function groupCode(s: string, size = 4): string {
  return s.match(new RegExp(`.{1,${size}}`, "g"))!.join("-");
}

export function hmacHex(key: Buffer, data: string | Buffer): string {
  return crypto.createHmac("sha256", key).update(data).digest("hex");
}

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex"), bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function randomId(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** AES-256-GCM. Output layout: [1-byte version=1][12-byte iv][16-byte tag][ciphertext]. */
export function aesGcmEncrypt(key: Buffer, plaintext: Buffer, aad?: Buffer): Buffer {
  if (key.length !== 32) throw new Error("AES key must be 32 bytes");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  if (aad) c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]);
}

export function aesGcmDecrypt(key: Buffer, blob: Buffer, aad?: Buffer): Buffer {
  if (blob.length < 29 || blob[0] !== 1) throw new Error("Unsupported ciphertext");
  const iv = blob.subarray(1, 13), tag = blob.subarray(13, 29), ct = blob.subarray(29);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  if (aad) d.setAAD(aad);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

/** Six-digit numeric code, uniformly distributed. */
export function randomDigits(n = 6): string {
  let s = "";
  for (let i = 0; i < n; i++) s += crypto.randomInt(0, 10).toString();
  return s;
}
