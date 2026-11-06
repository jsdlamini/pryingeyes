/**
 * Contact-details guard for anything shared with a group or on a status.
 *
 * People post their numbers in groups because it's the easy thing to do. Here it isn't possible:
 * phone numbers, email addresses and messaging links are rejected, and the composer offers a
 * contact code instead. The guard is deliberately strict and catches the usual disguises:
 * spaced or dotted digits, digits written as words ("seven six one…"), full-width digits,
 * the letter O for zero, and "name at gmail dot com".
 *
 * PryingEyes contact codes and links are stripped out first, so they never trip the guard.
 */
import { findPhoneNumbersInText, type CountryCode } from "libphonenumber-js";
import { env } from "./env";
import { HttpError } from "./errors";

export type Finding = "phone" | "email" | "messaging_link";

const WORD_DIGITS: Record<string, string> = {
  zero: "0", oh: "0", nought: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", double: "", triple: "",
};
const MESSAGING = /\b(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|t\.me|telegram\.me|signal\.me|m\.me|viber:\/\/|whatsapp:\/\/|tel:|sms:|mailto:)/i;
const EMAIL = /[\p{L}\p{N}._%+-]+\s*(?:@|\(at\)|\[at\]|\{at\}|\s+at\s+)\s*[\p{L}\p{N}-]+(?:\s*(?:\.|\(dot\)|\[dot\]|\{dot\}|\s+dot\s+)\s*[\p{L}\p{N}-]+)+/iu;
const DATE = /(?<![\d][-/.\s]?)(?:\d{4}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])|(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.](?:\d{4}|\d{2}))(?![-/.\s]?\d)/g;
const TIME = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

/** Removes PryingEyes contact codes and links so they aren't mistaken for numbers. */
export function stripCodes(text: string): string {
  const host = (() => { try { return new URL(env().APP_URL).host.replace(/\./g, "\\."); } catch { return "localhost"; } })();
  return text
    .replace(new RegExp(`(?:https?://)?${host}/[tg]/[0-9A-Za-z-]+`, "gi"), " ")
    .replace(/pryingeyes:\/\/[tg]\/[0-9A-Za-z-]+/gi, " ")
    .replace(/\b[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}\b/gi, (m) => (/[A-Z]/i.test(m) ? " " : m))
    .replace(/\b(?:[0-9A-HJKMNP-TV-Z]{4}-){3}[0-9A-HJKMNP-TV-Z]{4}\b/gi, (m) => (/[A-Z]/i.test(m) ? " " : m));
}

/** Rewrites disguised digits as plain digits. */
export function normaliseDigits(text: string): string {
  let s = text.normalize("NFKC");
  // Digit words, including runs like "seven six one two" and "double seven".
  s = s.replace(/\b(zero|oh|nought|one|two|three|four|five|six|seven|eight|nine|double|triple)\b/gi, (w) => {
    const k = w.toLowerCase();
    return k === "double" ? "\u0002" : k === "triple" ? "\u0003" : WORD_DIGITS[k];
  });
  s = s.replace(/\u0002\s*(\d)/g, "$1$1").replace(/\u0003\s*(\d)/g, "$1$1$1").replace(/[\u0002\u0003]/g, "");
  // O/o and l/I used as digits inside digit runs.
  s = s.replace(/(?<=\d[\s.-]?)[oO](?=[\s.-]?\d)/g, "0").replace(/(?<=\d[\s.-]?)[lI](?=[\s.-]?\d)/g, "1");
  return s;
}

/** The longest run of digits that are only separated by spaces, dots, dashes or brackets. */
function longestDigitRun(s: string): number {
  let best = 0;
  for (const m of s.matchAll(/\+?[\d(][\d\s().\-–—_/\\|,]*\d/g)) {
    const digits = m[0].replace(/\D/g, "").length;
    if (digits > best) best = digits;
  }
  return best;
}

export function findContactInfo(text: string): Finding[] {
  const found = new Set<Finding>();
  const raw = stripCodes(text ?? "");
  if (MESSAGING.test(raw)) found.add("messaging_link");
  if (EMAIL.test(raw)) found.add("email");

  const s = normaliseDigits(raw).replace(DATE, " ").replace(TIME, " ");
  const country = (env().DEFAULT_COUNTRY || "SZ") as CountryCode;
  if (findPhoneNumbersInText(s, country).length > 0 || findPhoneNumbersInText(s.replace(/[\s.\-_]/g, ""), country).length > 0) found.add("phone");
  else if (longestDigitRun(s) >= 7) found.add("phone");
  return [...found];
}

const WORDS: Record<Finding, string> = { phone: "a phone number", email: "an email address", messaging_link: "a messaging link" };

/** Throws a 400 explaining what was found and pointing to contact codes. */
export function assertNoContactInfo(text: string, field = "post") {
  const found = findContactInfo(text);
  if (found.length === 0) return;
  const what = found.map((f) => WORDS[f]).join(" and ");
  throw new HttpError(400, "contact_info_detected",
    `This ${field} looks like it contains ${what}. Contact details can't be shared in groups or statuses. Attach your contact code instead: people tap it to reach you without seeing your number.`,
    { found });
}
