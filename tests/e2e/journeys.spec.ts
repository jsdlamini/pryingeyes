import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ownerOnboard, createToken, callerOpens, emailCode } from "./util";

test.describe.configure({ mode: "serial" });

test("Tier 1: owner onboards with a passkey; caller sees a watermarked reveal that hides itself", async ({ page, browser }) => {
  await ownerOnboard(page);
  const { link } = await createToken(page, { context: "Business", label: "Salon bookings" });
  expect(link).toMatch(/\/t\/[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);

  const caller = await browser.newContext();
  const c = await callerOpens(caller, link);
  await expect(c.page.getByRole("heading", { name: "Salon bookings" })).toBeVisible();
  await c.page.getByRole("button", { name: "Show the number" }).click();
  const img = c.page.getByAltText(/watermarked with your handle/);
  await expect(img).toBeVisible();
  const src = await img.getAttribute("src");
  expect(src).toMatch(/^blob:/);                    // no URL that could be shared or cached
  expect(await c.page.content()).not.toMatch(/\+268\d{8}/); // never as text in the page
  await expect(c.page.getByRole("timer")).toContainText("Hidden in");

  // Owner's dashboard shows the activity
  await page.goto("/dashboard");
  await expect(page.getByText(`@${c.handle}`).first()).toBeVisible();
  await caller.close();
});

test("Tier 3: request with a note → owner approves → caller chats in the app; then panic revokes", async ({ page, browser }) => {
  await ownerOnboard(page);
  const { link } = await createToken(page, { context: "Marketplace", label: "Blue bicycle" });
  await expect(page.locator(".tier.t3")).toHaveCount(0); // share screen shows no tier badge; recommendation checked below
  const caller = await browser.newContext();
  const c = await callerOpens(caller, link);
  await expect(c.page.locator(".tier.t3")).toBeVisible();
  const t0 = Date.now() - 1000;
  await c.page.getByRole("button", { name: "Send me a code" }).click();
  await c.page.getByLabel("Code", { exact: true }).fill(await emailCode(c.page.request, c.email, t0, "to reach"));
  await c.page.getByRole("button", { name: "Confirm code" }).click();
  await c.page.getByLabel("Add a short note").fill("Hi, is the blue bicycle still available?");
  await c.page.getByRole("button", { name: "Send request" }).click();
  await expect(c.page.getByRole("heading", { name: "Waiting for the owner" })).toBeVisible();

  await page.goto("/dashboard/requests");
  const card = page.getByTestId("request-card").first();
  await expect(card).toContainText(`@${c.handle} wants to reach you`);
  await expect(card).toContainText("is the blue bicycle still available");
  await card.getByRole("button", { name: "Allow messages and calls" }).click();

  // Only in-app options: no phone-network call, and no number unless the owner chose to show it.
  await expect(c.page.getByRole("button", { name: /Call in the app/ })).toBeVisible({ timeout: 15_000 });
  await expect(c.page.getByRole("button", { name: "Show the number" })).toHaveCount(0);
  await expect(c.page.getByText(/Phone call/)).toHaveCount(0);
  await c.page.getByRole("button", { name: /Chat in the app/ }).click();
  await expect(c.page).toHaveURL(/\/chats\/[0-9a-f-]{36}/);

  // Panic
  await page.goto("/dashboard");
  await page.getByTestId("panic").click();
  await page.getByTestId("panic-confirm").click();
  await expect(page.getByText(/code\(s\) revoked/)).toBeVisible();
  const again = await caller.newPage();
  await again.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await again.getByLabel(/I'm a person, not a bot/).check();
  await again.getByRole("button", { name: "Continue" }).click();
  await expect(again.getByRole("heading", { name: "This code isn't available" })).toBeVisible();
  await caller.close();
});

test("Chat: caller and owner talk without exchanging numbers", async ({ page, browser }) => {
  await ownerOnboard(page);
  const { link } = await createToken(page, { context: "Business", label: "Car sale" });
  const caller = await browser.newContext();
  const c = await callerOpens(caller, link);
  await c.page.getByRole("button", { name: "Chat in the app" }).click();
  await expect(c.page).toHaveURL(/\/chats\/[0-9a-f-]{36}/);
  await c.page.getByLabel("Message").fill("Hello! Is the car still for sale?");
  await c.page.getByRole("button", { name: "Send" }).click();
  await expect(c.page.locator(".bubble.mine")).toContainText("still for sale");
  // The caller sees how to call privately; the owner is told about the new chat.
  await expect(c.page.getByRole("button", { name: /Call in the app/ })).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /Chats 1 new/ })).toBeVisible({ timeout: 10_000 });
  await page.goto("/settings");
  await expect(page.getByText(`@${c.handle} started a chat about "Car sale"`)).toBeVisible();
  await page.goto("/chats");
  await page.getByRole("link", { name: `@${c.handle}` }).click();
  await expect(page.locator(".bubble.theirs")).toContainText("still for sale");
  await page.getByLabel("Message").fill("Yes — come on Saturday.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(c.page.locator(".bubble.theirs")).toContainText("come on Saturday", { timeout: 10_000 });
  await caller.close();
});

test("In-app call over data: rings the owner's open app, connects through the relay, then shows in the chat", async ({ page, browser }) => {
  await ownerOnboard(page);
  const { link } = await createToken(page, { context: "Business", tier: 1, label: "Laptop for sale" });
  await page.goto("/dashboard");                                   // owner has PryingEyes open
  const caller = await browser.newContext({ permissions: ["microphone"] });
  const c = await callerOpens(caller, link);
  await c.page.getByRole("button", { name: /Call in the app/ }).click();
  await expect(c.page).toHaveURL(/\/calls\/[0-9a-f-]{36}/);
  await expect(c.page.getByTestId("call-status")).toContainText("Ringing");
  await expect(c.page.getByText(/has PryingEyes open/)).toBeVisible({ timeout: 10_000 });

  const banner = page.getByRole("alertdialog");
  await expect(banner).toContainText(`@${c.handle} is calling`, { timeout: 10_000 });
  await banner.getByRole("button", { name: "Answer" }).click();
  await expect(page).toHaveURL(/\/calls\/[0-9a-f-]{36}\?answer=1/);
  // The server only hands out relay-only ICE settings, so "Connected" means audio is flowing via TURN.
  await expect(page.getByTestId("call-status")).toHaveText("Connected", { timeout: 20_000 });
  await expect(c.page.getByTestId("call-status")).toHaveText("Connected", { timeout: 20_000 });
  const remoteLive = await c.page.evaluate(() => {
    const a = document.querySelector("audio") as HTMLAudioElement | null;
    const s = a?.srcObject as MediaStream | null;
    return !!s && s.getAudioTracks().some((t) => t.readyState === "live");
  });
  expect(remoteLive).toBe(true);
  await c.page.getByRole("button", { name: "Mute" }).click();
  await expect(c.page.getByRole("button", { name: "Unmute" })).toBeVisible();
  await page.waitForTimeout(2_000);
  await c.page.getByRole("button", { name: "Hang up" }).click();
  await expect(c.page.getByTestId("call-status")).toHaveText("Call ended");
  await expect(page.getByTestId("call-status")).toHaveText("Call ended", { timeout: 10_000 });
  expect(await c.page.content()).not.toMatch(/\+268\d{8}/);
  await caller.close();
});

test("In-app call when the owner's app is closed: the owner gets a missed call to answer in chat", async ({ page, browser }) => {
  await ownerOnboard(page);
  const { link } = await createToken(page, { context: "Business", tier: 1, label: "Fridge" });
  await page.goto("/privacy");                                      // a page that doesn't poll…
  const ownerCtx = page.context();
  await page.close();                                               // …then the owner closes the app entirely
  const caller = await browser.newContext({ permissions: ["microphone"] });
  const c = await callerOpens(caller, link);
  await c.page.waitForTimeout(9_000);                               // the owner's "online" flag lapses
  await c.page.getByRole("button", { name: /Call in the app/ }).click();
  await expect(c.page.getByText(/doesn't have PryingEyes open/)).toBeVisible({ timeout: 10_000 });
  await c.page.getByRole("button", { name: "Cancel" }).click();
  await expect(c.page.getByTestId("call-status")).toHaveText("You cancelled the call");

  const back = await ownerCtx.newPage();
  await back.goto("/settings");
  await expect(back.getByText(`Missed call from @${c.handle} about "Fridge"`)).toBeVisible();
  await back.goto("/chats");
  await back.getByRole("link", { name: `@${c.handle}` }).click();
  await expect(back.locator(".callevent")).toContainText("Missed call");
  await caller.close();
});

test("Phone input (show my number): pasting a +international number switches the country", async ({ page }) => {
  await ownerOnboard(page);
  await page.goto("/dashboard/numbers");
  const input = page.getByLabel("Phone number");
  await input.fill("+27 82 123 4567");
  await expect(page.getByLabel("Country")).toHaveValue("ZA");
  await expect(page.locator(".phone-dial")).toHaveText("+27");
  await expect(input).toHaveValue("082 123 4567");
  await page.getByLabel("Country").selectOption("SZ");
  await input.blur();
  await expect(page.getByText(/doesn't look like a Eswatini number/)).toBeVisible();
});

test("Passkey sign-in works on its own (no password)", async ({ page, context }) => {
  const o = await ownerOnboard(page);
  await page.getByTestId("account-menu").click();          // account menu, then sign out
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((u) => u.pathname === "/");        // sign-out redirects home once the request completes
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await context.clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(/\/dashboard/);              // signed-in home is My codes
  await expect(page.getByTestId("account-menu")).toContainText(`@${o.handle}`);
});

test("Accessibility: key pages have no serious or critical axe violations", async ({ page }) => {
  for (const path of ["/", "/signup", "/login", "/privacy", "/t/ABCDE-FGHJK"]) {
    await page.goto(path);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${path}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  }
});

test("@mobile caller gate fits a phone screen with no horizontal scroll", async ({ page }) => {
  await page.goto("/t/ABCDE-FGHJK");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("Handle box rejects autofilled emails and cleans typed handles before submit", async ({ page }) => {
  await page.goto("/signup");
  const handle = page.getByLabel("Handle");
  await expect(handle).toHaveValue(/^[a-z]+_[a-z]+_\d{2,}$/);
  const generated = await handle.inputValue();
  // Browser autofill dropping an email into the box: rejected, generated handle kept
  await handle.fill("projectmaai@outlook.com");
  await expect(page.getByText("Handles can't contain @")).toBeVisible();
  await expect(handle).toHaveValue(generated);
  // A typed name with a hyphen and a space is cleaned as you type
  await handle.fill("John-Dlamini 26");
  await expect(handle).toHaveValue("john_dlamini_26");
  await expect(page.getByText(/^Available$/)).toBeVisible();
  // Too short → the button stays disabled
  await handle.fill("jo");
  await page.getByLabel(/I'm 18 or older/).check();
  await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
  // Fix it and submit successfully
  await handle.fill(`john_${Math.random().toString(36).slice(2, 7)}`);
  await expect(page.getByText(/^Available$/)).toBeVisible();
  await page.getByLabel("Email").fill(`autofill_${Math.random().toString(36).slice(2, 8)}@example.test`);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
});
