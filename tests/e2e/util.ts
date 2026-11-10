import { expect, type Page, type BrowserContext, type APIRequestContext } from "@playwright/test";

export const rnd = () => Math.random().toString(36).slice(2, 8);
export function syntheticNumber() {
  return `+268${["76", "78", "79"][Math.floor(Math.random() * 3)]}${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}`;
}

/** Latest captured message (development outbox) matching a predicate. */
export async function outbox(request: APIRequestContext, match: (m: any) => boolean) {
  for (let i = 0; i < 20; i++) {
    const r = await request.get("/api/dev/outbox");
    const { messages } = await r.json();
    const m = messages.find(match);
    if (m) return m;
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error("message not found in dev outbox");
}
/** The newest 6-digit code emailed to this address after `after` (ms). Optionally filter by text, e.g. "to reach". */
export const emailCode = async (request: APIRequestContext, email: string, after = 0, contains?: string) =>
  (await outbox(request, (m) => m.channel === "email" && m.to === email && new Date(m.createdAt).getTime() >= after
    && (!contains || m.body.includes(contains)) && /\b\d{6}\b/.test(m.body))).body.match(/\b(\d{6})\b/)[1];

/**
 * New person on the sign-up page: email + password, keep the generated handle, confirm the email
 * from the outbox link, sign in. They land back where they started (a code, an invite, or My codes).
 */
export async function emailSignUp(page: Page) {
  const email = `person_${rnd()}@example.test`, password = "correct horse battery staple";
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await expect(page.getByLabel("Handle")).toHaveValue(/^[a-z]+_[a-z]+_\d{2,}$/);
  const first = await page.getByLabel("Handle").inputValue();
  await page.getByRole("button", { name: "Suggest another" }).click();   // a different one, still valid
  await expect(page.getByLabel("Handle")).not.toHaveValue(first);
  await expect(page.getByText(/^Available/)).toBeVisible();
  const handle = await page.getByLabel("Handle").inputValue();
  await page.getByLabel(/I'm 18 or older/).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const mail = await outbox(page.request, (m) => m.channel === "email" && m.to === email && m.body.includes("verify-email"));
  await page.goto(mail.body.match(/https?:\/\/[^\s]+(\/verify-email\?[^\s]+)/)[1]);
  await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
  await page.locator(".card").getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return { email, password, handle };
}

/** Adds a virtual platform authenticator so passkeys work headlessly (Chrome DevTools Protocol). */
export async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  return cdp;
}

/** Owner: email sign-up → verify → sign in → passkey → recovery codes → add number. Returns the page on the dashboard. */
export async function ownerOnboard(page: Page) {
  const email = `owner_${rnd()}@example.test`, password = "correct horse battery staple";
  await virtualAuthenticator(page);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  // The handle arrives pre-filled with a generated, available one; keep it.
  await expect(page.getByLabel("Handle")).toHaveValue(/^[a-z]+_[a-z]+_\d{2,}$/);
  await expect(page.getByText("Available — keep it or make it your own.")).toBeVisible();
  const handle = await page.getByLabel("Handle").inputValue();
  await page.getByLabel("Password").fill(password);
  await page.getByLabel(/I'm 18 or older/).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  const mail = await outbox(page.request, (m) => m.channel === "email" && m.to === email);
  await page.goto(mail.body.match(/https?:\/\/\S+/)[0].replace(/^https?:\/\/[^/]+/, ""));
  await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Codes work without a number; this owner also adds one so that "Show the number" can be tested.
  await expect(page.getByRole("heading", { name: "Your codes" })).toBeVisible();
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Add a phone number" })).toBeVisible();
  await page.getByRole("button", { name: /Create a passkey/ }).click();
  await expect(page.getByText("Save these recovery codes now")).toBeVisible();
  await expect(page.locator(".recovery span")).toHaveCount(10);
  await page.getByRole("button", { name: "I've saved them" }).click();
  const phone = syntheticNumber();
  // Owner uses the country picker + national number (no dialling code typed).
  await page.getByLabel("Country").selectOption("SZ");
  await expect(page.locator(".phone-dial")).toHaveText("+268");
  await page.getByLabel("Phone number").fill(phone.slice(4));
  await page.getByRole("button", { name: "Add number" }).click();
  await expect(page.getByText(`ending ··${phone.slice(-2)}`)).toBeVisible();
  return { email, handle, password, phone };
}

/** Creates a code. By default it uses the owner's first number (if any); pass number: false for an app-only code. */
export async function createToken(page: Page, opts: { context?: string; tier?: number; label: string; number?: boolean }) {
  await page.goto("/dashboard/tokens/new");
  // Retry clicks until React has hydrated and the selection actually sticks.
  if (opts.context) {
    const chip = page.getByRole("button", { name: opts.context, exact: true });
    await expect(async () => { await chip.click(); await expect(chip).toHaveAttribute("aria-pressed", "true", { timeout: 500 }); }).toPass();
  }
  if (opts.tier) {
    const card = page.locator(".tiercard").nth(opts.tier - 1);
    await expect(async () => { await card.click(); await expect(card).toHaveAttribute("aria-pressed", "true", { timeout: 500 }); }).toPass();
  }
  await page.getByLabel("Name", { exact: true }).fill(opts.label);
  if (opts.number !== false && (await page.request.get("/api/me").then((r) => r.json())).numbers > 0) {
    const sel = page.getByLabel("Show my number (optional)");
    await expect(sel.locator("option")).not.toHaveCount(1);
    await sel.selectOption({ index: 1 });
  }
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByRole("heading", { name: "Ready to share" })).toBeVisible();
  return { link: (await page.getByTestId("share-link").innerText()).trim(), short: (await page.getByTestId("share-short").innerText()).trim() };
}

/** Caller: open a code while signed out, sign up by phone, pass the human check. */
export async function callerOpens(ctx: BrowserContext, link: string) {
  const page = await ctx.newPage();
  const path = link.replace(/^https?:\/\/[^/]+/, "");
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
  await page.getByTestId("gate-signup").click();
  const { email, handle } = await emailSignUp(page);
  // Back on the same code, already filled in.
  await expect(page).toHaveURL(new RegExp(path.replace(/[-/]/g, "\\$&")));
  await expect(page.getByText("You're trying to reach")).toBeVisible();
  await passHumanCheck(page);
  return { page, email, handle };
}

/** Ticks the human check. Since 0.11 the gate continues by itself; click Continue only if it's still waiting. */
export async function passHumanCheck(page: Page) {
  await page.getByLabel(/I'm a person, not a bot/).check();
  const cont = page.getByRole("button", { name: "Continue" });
  await page.waitForTimeout(500);
  if (await cont.isEnabled({ timeout: 500 }).catch(() => false)) await cont.click({ timeout: 2000 }).catch(() => undefined);
  await expect(cont).toHaveCount(0, { timeout: 10_000 });
}
