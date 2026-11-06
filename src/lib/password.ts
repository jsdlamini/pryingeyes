import { hash, verify } from "@node-rs/argon2";
import { badRequest } from "./errors";

// OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1).
const OPTS = { algorithm: 2 /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

const COMMON = new Set([
  "password", "password1", "password123", "1234567890", "12345678910", "qwertyuiop", "iloveyou12",
  "letmein123", "welcome123", "admin12345", "abcdefghij", "pryingeyes", "pryingeyes1",
]);

export function checkPasswordPolicy(pw: string) {
  if (typeof pw !== "string" || pw.length < 10) throw badRequest("weak_password", "Use at least 10 characters.");
  if (pw.length > 128) throw badRequest("weak_password", "Use at most 128 characters.");
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw)) throw badRequest("weak_password", "That password is too easy to guess.");
}

export const hashPassword = (pw: string) => hash(pw, OPTS);
export async function verifyPassword(stored: string, pw: string) {
  try { return await verify(stored, pw); } catch { return false; }
}

// Used to keep login timing uniform when the account does not exist.
let dummy: string | null = null;
export async function burnPasswordTime(pw: string) {
  dummy ??= await hashPassword("timing-equaliser-not-a-real-password");
  await verifyPassword(dummy, pw);
}
