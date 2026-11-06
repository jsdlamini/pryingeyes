/**
 * KeyProvider: wraps and unwraps per-user data keys (envelope encryption).
 *
 * `LocalKeyProvider` holds the key-encryption key (KEK) in configuration and is meant for
 * development and single-host deployments. A cloud KMS implementation (AWS KMS, GCP KMS,
 * Azure Key Vault) implements the same interface: wrap = KMS Encrypt, unwrap = KMS Decrypt.
 */
import crypto from "node:crypto";
import { aesGcmDecrypt, aesGcmEncrypt } from "./crypto";
import { env } from "./env";

export interface KeyProvider {
  readonly currentVersion: number;
  wrap(dataKey: Buffer, context: string): Promise<{ wrapped: Buffer; version: number }>;
  unwrap(wrapped: Buffer, version: number, context: string): Promise<Buffer>;
}

export class LocalKeyProvider implements KeyProvider {
  private keks = new Map<number, Buffer>();
  constructor(current: { version: number; key: Buffer }, previous: Record<string, string> = {}) {
    this.currentVersion = current.version;
    this.keks.set(current.version, current.key);
    for (const [v, k] of Object.entries(previous)) {
      const buf = Buffer.from(k, "base64");
      if (buf.length !== 32) throw new Error(`KEK version ${v} is not 32 bytes`);
      this.keks.set(Number(v), buf);
    }
  }
  readonly currentVersion: number;

  async wrap(dataKey: Buffer, context: string) {
    const kek = this.keks.get(this.currentVersion)!;
    return { wrapped: aesGcmEncrypt(kek, dataKey, Buffer.from(context)), version: this.currentVersion };
  }

  async unwrap(wrapped: Buffer, version: number, context: string) {
    const kek = this.keks.get(version);
    if (!kek) throw new Error(`No KEK for version ${version}`);
    return aesGcmDecrypt(kek, wrapped, Buffer.from(context));
  }
}

let provider: KeyProvider | null = null;
export function keyProvider(): KeyProvider {
  if (provider) return provider;
  const e = env();
  provider = new LocalKeyProvider(
    { version: e.MASTER_KEK_VERSION, key: Buffer.from(e.MASTER_KEK, "base64") },
    JSON.parse(e.KEK_PREVIOUS),
  );
  return provider;
}
export function resetKeyProvider() { provider = null; }

export const newDataKey = () => crypto.randomBytes(32);

/** Derived single-purpose keys for keyed hashing. */
export const tokenPepper = () => Buffer.from(env().TOKEN_PEPPER, "base64");
export const blindIndexKey = () => Buffer.from(env().BLIND_INDEX_KEY, "base64");
export const secretsHmacKey = () => Buffer.from(env().SECRETS_HMAC_KEY, "base64");
