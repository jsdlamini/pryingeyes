"use client";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body: any) { super(message); }
}

type StepUpHandler = () => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;
export function registerStepUp(h: StepUpHandler | null) { stepUpHandler = h; }

/** JSON fetch with uniform errors. Retries once after a successful step-up when asked to. */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; retry?: boolean } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const code = data?.error ?? "error";
    if (code === "step_up_required" && opts.retry !== false && stepUpHandler && (await stepUpHandler())) {
      return api<T>(path, { ...opts, retry: false });
    }
    if (code === "signin_required" && typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    if (code === "mfa_required" && typeof window !== "undefined") {
      window.location.href = `/login/mfa?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(res.status, code, data?.message ?? "Something went wrong.", data);
  }
  return data as T;
}

export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Please try again.");

export function relTime(d: string | Date | null | undefined) {
  if (!d) return "";
  const ms = new Date(d).getTime() - Date.now();
  const abs = Math.abs(ms), m = Math.round(abs / 60000);
  const s = m < 1 ? "just now" : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
  if (m < 1) return s;
  return ms < 0 ? `${s} ago` : `in ${s}`;
}
export const clock = (d: string | Date) => new Date(d).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
