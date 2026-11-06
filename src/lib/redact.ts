/**
 * Redaction of phone-number-shaped strings and secrets. Applied to every log line.
 *
 * A phone-number shape: an optional "+", then 7–15 digits that may be separated by spaces,
 * dots, dashes or parentheses. Timestamps/UUIDs are not matched because of the separator rules.
 */
const PHONE_RE = /(?<![\w-])\+?\(?\d(?:[\s().-]?\d){6,14}(?![\w-])/g;
const TOKEN_PATH_RE = /\/t\/[0-9A-Za-z-]{8,}/g;
const SECRET_KEYS = /^(password|passwordHash|code|otp|token|secret|cookie|authorization|captcha|note|body|text|number|phone|e164|to)$/i;

// ISO-8601 timestamps (with optional fractional seconds) are not phone numbers; protect them.
const ISO_TS_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?/g;

function outsideTimestamps(s: string, fn: (part: string) => string): string {
  let out = "", last = 0;
  for (const m of s.matchAll(ISO_TS_RE)) {
    out += fn(s.slice(last, m.index)) + m[0];
    last = m.index! + m[0].length;
  }
  return out + fn(s.slice(last));
}

export function redactString(s: string): string {
  return outsideTimestamps(s, (p) => p.replace(PHONE_RE, "[redacted-number]")).replace(TOKEN_PATH_RE, "/t/[redacted-token]");
}

export function redactValue(v: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof v === "string") return redactString(v);
  if (Array.isArray(v)) return v.map((x) => redactValue(x, depth + 1));
  if (v instanceof Error) return { name: v.name, message: redactString(v.message), stack: v.stack ? redactString(v.stack) : undefined };
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redactValue(val, depth + 1);
    }
    return out;
  }
  return v;
}

/** True if the text contains anything shaped like a phone number. Used by CI scans. */
export function findPhoneShapes(s: string): string[] {
  const found: string[] = [];
  outsideTimestamps(s, (p) => { found.push(...(p.match(PHONE_RE) ?? [])); return p; });
  return found;
}
export const containsPhoneShape = (s: string) => findPhoneShapes(s).length > 0;
