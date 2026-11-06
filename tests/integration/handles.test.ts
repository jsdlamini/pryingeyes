import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { resetAll, syntheticNumber } from "../helpers";
import { Client, lastOutbox, codeIn, maskedTo } from "../client";
import { handleSchema } from "@/lib/accounts";
import { suggestHandle } from "@/lib/handles";
import * as handle from "@/app/api/auth/handle/route";
import * as signup from "@/app/api/auth/signup/route";
import * as me from "@/app/api/me/route";

describe("generated handles", () => {
  beforeEach(resetAll);

  it("suggests valid, varied, free handles that reveal nothing about the person", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const h = await suggestHandle();
      expect(handleSchema.parse(h)).toBe(h);
      expect(h).toMatch(/^[a-z]+_[a-z]+_\d{2,}$/);
      seen.add(h);
    }
    expect(seen.size).toBeGreaterThan(190);
    const r = await new Client().get(handle.GET, "/api/auth/handle");
    expect(handleSchema.parse(r.body.handle)).toBe(r.body.handle);
  });

  it("checks availability and validity", async () => {
    await db().insert(schema.users).values({ handle: "taken_name", status: "active" });
    const c = new Client();
    expect((await c.get(handle.GET, "/api/auth/handle?check=Taken_Name")).body).toEqual({ handle: "taken_name", valid: true, available: false });
    expect((await c.get(handle.GET, "/api/auth/handle?check=free_name")).body.available).toBe(true);
    expect((await c.get(handle.GET, "/api/auth/handle?check=a")).body.valid).toBe(false);
  });

  it("email sign-up without a handle gets a generated one", async () => {
    const c = new Client();
    const r = await c.post(signup.POST, "/x", { email: "nohandle@example.test", password: "correct horse battery", ageConfirmed: true });
    expect(r.status).toBe(200);
    const [u] = await db().select().from(schema.users).where(eq(schema.users.email, "nohandle@example.test"));
    expect(u.handle).toMatch(/^[a-z]+_[a-z]+_\d{2,}$/);
    expect(u.handle).not.toContain("nohandle");
  });

  it("a taken chosen handle is refused with a fresh suggestion", async () => {
    await db().insert(schema.users).values({ handle: "popular", status: "active" });
    const e = await new Client().post(signup.POST, "/x", { email: "x@example.test", password: "correct horse battery", handle: "popular", ageConfirmed: true });
    expect(e.body).toMatchObject({ error: "handle_taken" });
    expect(e.body.suggestion).toBeTruthy();
  });

  it("a person's own chosen handle is still respected", async () => {
    const c = new Client();
    await c.post(signup.POST, "/x", { email: "mine@example.test", password: "correct horse battery", handle: "My.Own_Name", ageConfirmed: true });
    const [u] = await db().select().from(schema.users).where(eq(schema.users.email, "mine@example.test"));
    expect(u.handle).toBe("my.own_name");
  });
});

import { sanitizeHandle } from "@/lib/handles";

describe("invalid handles are explained and repaired, never silently accepted", () => {
  beforeEach(resetAll);

  it("cleans typed handles and refuses anything with @", () => {
    expect(sanitizeHandle("John-Dlamini 2026")).toBe("john_dlamini_2026");
    expect(sanitizeHandle("__x")).toBeNull();
    expect(sanitizeHandle("johnson_sikhumbuzo_dlamini_mbabane")).toHaveLength(24);
    expect(sanitizeHandle("projectmaai@outlook.com")).toBeNull();
  });

  it.each([
    ["an autofilled email", "someone@example.test"],
    ["a hyphenated name", "john-dlamini"],
    ["a name with a space", "John Dlamini"],
    ["one that is too long", "johnson_sikhumbuzo_dlamini_mbabane"],
    ["one that starts with a dot", ".hidden"],
  ])("email sign-up with %s gets invalid_handle, a clear message and a valid suggestion", async (_label, handle) => {
    const r = await new Client().post(signup.POST, "/x", { email: `h${Math.random().toString(36).slice(2, 8)}@example.test`, password: "correct horse battery", handle, ageConfirmed: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_handle");
    expect(r.body.message).toMatch(/^Handle: /);
    expect(r.body.message).not.toMatch(/^input:/);
    expect(handleSchema.parse(r.body.suggestion)).toBe(r.body.suggestion);
    expect(r.body.suggestion).not.toContain("example");
    // Re-submitting with the suggestion succeeds
    const ok = await new Client().post(signup.POST, "/x", { email: `ok${Math.random().toString(36).slice(2, 8)}@example.test`, password: "correct horse battery", handle: r.body.suggestion, ageConfirmed: true });
    expect(ok.status).toBe(200);
  });

});

import * as providers from "@/lib/providers";
import { vi } from "vitest";

describe("email delivery failures", () => {
  beforeEach(resetAll);

  it("a failed confirmation email gives a clear 503, and signing up again works", async () => {
    const spy = vi.spyOn(providers, "sendEmail").mockRejectedValueOnce(new Error("resend down"));
    const email = "retry@example.test";
    const first = await new Client().post(signup.POST, "/x", { email, password: "correct horse battery", ageConfirmed: true });
    expect(first.status).toBe(503);
    expect(first.body.error).toBe("email_unavailable");
    spy.mockRestore();
    const second = await new Client().post(signup.POST, "/x", { email, password: "another strong passphrase", ageConfirmed: true });
    expect(second.status).toBe(200);
    const mail = await lastOutbox({ channel: "email", to: email });
    expect(mail.subject).toBe("Confirm your PryingEyes email");
    const users = await db().select().from(schema.users).where(eq(schema.users.email, email));
    expect(users).toHaveLength(1);
  });

  it("an unconfirmed sign-up can be redone; old links stop working", async () => {
    const email = "redo@example.test";
    await new Client().post(signup.POST, "/x", { email, password: "correct horse battery", ageConfirmed: true });
    const oldToken = (await lastOutbox({ channel: "email", to: email })).body.match(/token=([\w-]+)/)![1];
    await new Client().post(signup.POST, "/x", { email, password: "a different passphrase", ageConfirmed: true });
    const newToken = (await lastOutbox({ channel: "email", to: email })).body.match(/token=([\w-]+)/)![1];
    expect(newToken).not.toBe(oldToken);
    const verify = await import("@/app/api/auth/verify-email/route");
    expect((await new Client().post(verify.POST, "/x", { token: oldToken })).body.error).toBe("link_invalid");
    expect((await new Client().post(verify.POST, "/x", { token: newToken })).status).toBe(200);
  });
});
