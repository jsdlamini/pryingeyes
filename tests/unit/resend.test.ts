import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resendSend, textToHtml, RESEND_URL } from "@/lib/providers/resend";
import { resetEnvCache, env } from "@/lib/env";

const KEY = "re_test_1234567890abcdef";
function ok(id = "email_123") { return new Response(JSON.stringify({ id }), { status: 200, headers: { "content-type": "application/json" } }); }
function err(status: number, name = "error", headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ name, message: `failed ${status}` }), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("Resend adapter", () => {
  beforeEach(() => {
    Object.assign(process.env, { EMAIL_PROVIDER: "resend", RESEND_API_KEY: KEY, EMAIL_FROM: "PryingEyes <no-reply@pryingeyes.example>", EMAIL_REPLY_TO: "support@pryingeyes.example" });
    resetEnvCache();
  });
  afterEach(() => {
    Object.assign(process.env, { EMAIL_PROVIDER: "outbox", RESEND_API_KEY: "", EMAIL_REPLY_TO: "" });
    resetEnvCache();
  });

  it("posts the documented request: bearer key, idempotency key, from/to/subject/text/html/reply_to/tags", async () => {
    const f = vi.fn(async () => ok("abc"));
    const id = await resendSend({ to: "person@example.test", subject: "Hello", text: "Line one\n\nOpen https://x.example/a?b=1", tag: "verification" }, { fetchImpl: f as any });
    expect(id).toBe("abc");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_URL);
    expect(init.method).toBe("POST");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe(`Bearer ${KEY}`);
    expect(h["Idempotency-Key"]).toMatch(/^pryingeyes\/verification\/[0-9a-f-]{36}$/);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ from: "PryingEyes <no-reply@pryingeyes.example>", to: ["person@example.test"], subject: "Hello",
      text: "Line one\n\nOpen https://x.example/a?b=1", reply_to: "support@pryingeyes.example", tags: [{ name: "category", value: "verification" }] });
    expect(body.html).toContain('<a href="https://x.example/a?b=1"');
  });

  it("retries 429 and 5xx with the SAME idempotency key, then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(err(429, "rate_limit_exceeded", { "retry-after": "0" })).mockResolvedValueOnce(err(503)).mockResolvedValueOnce(ok());
    await resendSend({ to: "p@example.test", subject: "s", text: "t" }, { fetchImpl: f as any, backoffMs: 1 });
    expect(f).toHaveBeenCalledTimes(3);
    const keys = f.mock.calls.map((c) => (c[1] as RequestInit).headers as Record<string, string>).map((h) => h["Idempotency-Key"]);
    expect(new Set(keys).size).toBe(1);
  });

  it("does not retry client errors, and gives up after 3 attempts on server errors", async () => {
    const f1 = vi.fn(async () => err(422, "validation_error"));
    await expect(resendSend({ to: "p@example.test", subject: "s", text: "t" }, { fetchImpl: f1 as any, backoffMs: 1 })).rejects.toMatchObject({ status: 422, name: "validation_error" });
    expect(f1).toHaveBeenCalledTimes(1);
    const f2 = vi.fn(async () => err(500));
    await expect(resendSend({ to: "p@example.test", subject: "s", text: "t" }, { fetchImpl: f2 as any, backoffMs: 1 })).rejects.toMatchObject({ status: 500 });
    expect(f2).toHaveBeenCalledTimes(3);
  });

  it("escapes HTML in the message body", () => {
    expect(textToHtml("<script>alert(1)</script> & co")).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; co");
  });
});

describe("email configuration checks", () => {
  afterEach(() => {
    delete process.env.APP_ENV;
    Object.assign(process.env, { EMAIL_PROVIDER: "outbox", RESEND_API_KEY: "", EMAIL_FROM: "PryingEyes <onboarding@resend.dev>" });
    resetEnvCache();
  });

  it("needs a real-looking Resend key when EMAIL_PROVIDER=resend", () => {
    Object.assign(process.env, { EMAIL_PROVIDER: "resend", RESEND_API_KEY: "" }); resetEnvCache();
    expect(() => env()).toThrow(/RESEND_API_KEY/);
  });

  it("refuses the resend.dev test sender outside development", () => {
    Object.assign(process.env, { APP_ENV: "staging", EMAIL_PROVIDER: "resend", RESEND_API_KEY: KEY, EMAIL_FROM: "PryingEyes <onboarding@resend.dev>" }); resetEnvCache();
    expect(() => env()).toThrow(/own verified domain/);
  });

  it("allows the resend.dev test sender in development", () => {
    Object.assign(process.env, { EMAIL_PROVIDER: "resend", RESEND_API_KEY: KEY, EMAIL_FROM: "PryingEyes <onboarding@resend.dev>" }); resetEnvCache();
    expect(env().EMAIL_FROM).toContain("resend.dev");
  });
});
