/**
 * Resend email adapter (https://resend.com) — plain HTTPS, no SDK.
 *
 *   POST https://api.resend.com/emails   Authorization: Bearer <RESEND_API_KEY>
 *
 * - One Idempotency-Key per message, reused across retries, so a retry can never send twice
 *   (Resend keeps keys for 24 hours).
 * - Retries only 429 and 5xx, with backoff (honours Retry-After), up to 3 attempts in total.
 *   400/401/403/409/422 are configuration or content errors and fail at once.
 * - Sends a plain-text body plus a minimal HTML version of the same text.
 * - Never logs recipient addresses or message content.
 */
import crypto from "node:crypto";
import { env } from "../env";
import { log } from "../log";

export const RESEND_URL = "https://api.resend.com/emails";
const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 10_000;

export class ResendError extends Error {
  constructor(public status: number, public name: string, message: string) { super(message); }
}

export interface ResendMessage { to: string; subject: string; text: string; tag?: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Minimal, accessible HTML rendering of a plain-text message (links made clickable). */
export function textToHtml(text: string): string {
  const body = esc(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#b2531c">$1</a>')
    .split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f7f8fa">`
    + `<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e6eb;border-radius:10px;padding:24px;`
    + `font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1c2431">`
    + `<div style="font-weight:800;font-size:18px;margin-bottom:16px">Prying<span style="color:#b2531c">Eyes</span></div>${body}`
    + `<p style="margin:20px 0 0;font-size:12px;color:#5f6877">You received this because of activity on your PryingEyes account.</p>`
    + `</div></body></html>`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function resendSend(m: ResendMessage, opts: { fetchImpl?: typeof fetch; backoffMs?: number } = {}): Promise<string> {
  const e = env();
  const doFetch = opts.fetchImpl ?? fetch;
  const idempotencyKey = `pryingeyes/${m.tag ?? "email"}/${crypto.randomUUID()}`;
  const payload: Record<string, unknown> = {
    from: e.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: textToHtml(m.text),
  };
  if (e.EMAIL_REPLY_TO) payload.reply_to = e.EMAIL_REPLY_TO;
  if (m.tag) payload.tags = [{ name: "category", value: m.tag.replace(/[^A-Za-z0-9_-]/g, "_") }];

  let lastErr: ResendError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await doFetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      lastErr = new ResendError(0, "network_error", err instanceof Error ? err.message : "network error");
      if (attempt < MAX_ATTEMPTS) { await sleep((opts.backoffMs ?? 1000) * 2 ** (attempt - 1)); continue; }
      break;
    }
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      log.info({ provider: "resend", emailId: data.id, tag: m.tag }, "email sent");
      return data.id ?? "";
    }
    const body = (await res.json().catch(() => ({}))) as { name?: string; message?: string };
    lastErr = new ResendError(res.status, body.name ?? "error", body.message ?? `HTTP ${res.status}`);
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) break;
    const ra = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 10) * 1000 : (opts.backoffMs ?? 1000) * 2 ** (attempt - 1));
  }
  log.warn({ provider: "resend", status: lastErr?.status, error: lastErr?.name, tag: m.tag }, "email not sent");
  throw lastErr ?? new ResendError(0, "unknown", "email not sent");
}
