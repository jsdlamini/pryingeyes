/**
 * Number vault (rule 3). The only module that encrypts phone numbers, and — through
 * `decryptNumberFor` — the only place they are decrypted. Callers of `decryptNumberFor`
 * must be the reveal or data-export services. Numbers are optional: an owner stores one only
 * to let approved people see it once.
 */
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { db, schema, type DB } from "@/db";
import { aesGcmDecrypt, aesGcmEncrypt, hmacHex } from "./crypto";
import { blindIndexKey, keyProvider, newDataKey } from "./keys";
import { env } from "./env";
import { badRequest, conflict } from "./errors";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export interface NormalisedPhone { e164: string; country: string | null }

const COUNTRIES = new Set<string>(getCountries());
const countryName = (cc: string) => { try { return new Intl.DisplayNames(["en"], { type: "region" }).of(cc) ?? cc; } catch { return cc; } };

/** Validates an ISO 3166 alpha-2 country the client selected (e.g. "SZ"). */
export function checkCountry(country: string | null | undefined): CountryCode {
  const cc = (country ?? env().DEFAULT_COUNTRY).toUpperCase();
  if (!COUNTRIES.has(cc)) throw badRequest("invalid_country", "Choose a country from the list.");
  return cc as CountryCode;
}

/**
 * Parses a number typed for the selected country (national format, e.g. "7612 3456" with SZ).
 * A number starting with "+" or "00" is international and wins over the selected country.
 */
export function normalisePhone(raw: string, country?: string | null): NormalisedPhone {
  const cc = checkCountry(country);
  const input = (raw ?? "").trim().replace(/^00(?=[1-9])/, "+");
  if (input.replace(/\D/g, "").length < 4 || input.length > 32) throw badRequest("invalid_phone", "Enter the phone number.");
  const p = parsePhoneNumberFromString(input, cc);
  if (!p || !p.isValid()) {
    const where = input.startsWith("+") ? "" : ` for ${countryName(cc)} (+${getCountryCallingCode(cc)})`;
    throw badRequest("invalid_phone", `That isn't a valid phone number${where}. Check the number and the country.`);
  }
  return { e164: p.number, country: p.country ?? null };
}

export const blindIndex = (e164: string) => hmacHex(blindIndexKey(), `phone:${e164}`);
export const maskHint = (e164: string) => e164.slice(-2);
export const masked = (hint: string) => `····${hint}`;

// ---- per-user data keys ---------------------------------------------------
const keyCache = new Map<string, { key: Buffer; at: number }>();
const CACHE_MS = 5 * 60 * 1000;

export async function userDataKey(userId: string, exec: DB | Tx = db()): Promise<Buffer> {
  const hit = keyCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.key;
  const ctx = `user:${userId}`;
  const rows = await exec.select().from(schema.userKeys).where(eq(schema.userKeys.userId, userId));
  let key: Buffer;
  if (rows[0]) {
    key = await keyProvider().unwrap(rows[0].wrappedKey, rows[0].kekVersion, ctx);
  } else {
    key = newDataKey();
    const { wrapped, version } = await keyProvider().wrap(key, ctx);
    await exec.insert(schema.userKeys).values({ userId, wrappedKey: wrapped, kekVersion: version }).onConflictDoNothing();
    const again = await exec.select().from(schema.userKeys).where(eq(schema.userKeys.userId, userId));
    key = await keyProvider().unwrap(again[0].wrappedKey, again[0].kekVersion, ctx);
  }
  keyCache.set(userId, { key, at: Date.now() });
  return key;
}
export function forgetDataKey(userId: string) { keyCache.delete(userId); }

/** Re-wrap every data key under the current KEK version (break-glass key rotation). */
export async function rewrapAllDataKeys(): Promise<number> {
  const rows = await db().select().from(schema.userKeys);
  let n = 0;
  for (const r of rows) {
    if (r.kekVersion === keyProvider().currentVersion) continue;
    const ctx = `user:${r.userId}`;
    const key = await keyProvider().unwrap(r.wrappedKey, r.kekVersion, ctx);
    const { wrapped, version } = await keyProvider().wrap(key, ctx);
    await db().update(schema.userKeys).set({ wrappedKey: wrapped, kekVersion: version }).where(eq(schema.userKeys.userId, r.userId));
    n++;
  }
  keyCache.clear();
  return n;
}

export async function encryptForUser(userId: string, plaintext: string, aad: string, exec?: DB | Tx) {
  return aesGcmEncrypt(await userDataKey(userId, exec), Buffer.from(plaintext, "utf8"), Buffer.from(aad));
}
export async function decryptForUser(userId: string, blob: Buffer, aad: string) {
  return aesGcmDecrypt(await userDataKey(userId), blob, Buffer.from(aad)).toString("utf8");
}

// ---- numbers -------------------------------------------------------------
export async function storeNumber(
  userId: string, raw: string, kind: "account" | "protected", label = "", exec: DB | Tx = db(), selectedCountry?: string | null,
): Promise<{ id: string; hint: string; country: string | null; blindIndex: string }> {
  const { e164, country } = normalisePhone(raw, selectedCountry);
  const bi = blindIndex(e164);
  if (kind === "account") {
    const taken = await exec.select({ id: schema.phoneNumbers.id, userId: schema.phoneNumbers.userId }).from(schema.phoneNumbers)
      .where(and(eq(schema.phoneNumbers.kind, "account"), eq(schema.phoneNumbers.blindIndex, bi)));
    if (taken[0] && taken[0].userId !== userId) throw conflict("phone_in_use", "That number is already linked to another account.");
    if (taken[0]) return { id: taken[0].id, hint: maskHint(e164), country, blindIndex: bi };
  } else {
    const dup = await exec.select({ id: schema.phoneNumbers.id }).from(schema.phoneNumbers)
      .where(and(eq(schema.phoneNumbers.userId, userId), eq(schema.phoneNumbers.kind, "protected"), eq(schema.phoneNumbers.blindIndex, bi)));
    if (dup[0]) throw conflict("number_exists", "You've already added this number.");
  }
  const id = crypto.randomUUID();
  const ciphertext = await encryptForUser(userId, e164, `phone:${id}`, exec);
  await exec.insert(schema.phoneNumbers).values({
    id, userId, kind, ciphertext, blindIndex: bi, country, hint: maskHint(e164), label: label.slice(0, 60),
  });
  return { id, hint: maskHint(e164), country, blindIndex: bi };
}

export type DecryptPurpose = "reveal" | "export";

/** Decrypts a stored number. Restricted: see module header. */
export async function decryptNumberFor(numberId: string, _purpose: DecryptPurpose): Promise<string> {
  const rows = await db().select().from(schema.phoneNumbers).where(eq(schema.phoneNumbers.id, numberId));
  if (!rows[0]) throw new Error("number not found");
  return decryptForUser(rows[0].userId, rows[0].ciphertext, `phone:${numberId}`);
}

