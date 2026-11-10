/**
 * Phone-size screenshots of the 0.12 screens (Home, new code, Requests, caller screen, Chat), for
 * comparing with the design canvas. Needs the website on :3000 in development mode (dev outbox), and a
 * Playwright config whose testDir is tests/screens (baseURL http://localhost:3000). Saves to test-results/redesign-0.12.
 */
import { test, expect, type Page } from "@playwright/test";
import { createToken, emailCode, emailSignUp, ownerOnboard } from "../e2e/util";

const OUT = process.env.SHOTS_DIR ?? "test-results/redesign-0.12";
const shot = (p: Page, name: string) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: "disabled" });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" };

test("0.12 screens on a phone", async ({ browser }) => {
  test.setTimeout(300_000);
  const owner = await browser.newContext(PHONE);
  const page = await owner.newPage();
  await ownerOnboard(page);
  const { link } = await createToken(page, { context: "Marketplace", label: "Work", tier: 3 });
  await shot(page, "02-share-new-code");

  const callerCtx = await browser.newContext(PHONE);
  // Like callerOpens(), but the gate continues by itself once the human check passes.
  const cp = await callerCtx.newPage();
  await cp.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await cp.getByTestId("gate-signup").click();
  const who = await emailSignUp(cp);
  await expect(cp.getByText("You're trying to reach")).toBeVisible();
  await cp.getByLabel(/I'm a person, not a bot/).check();
  await cp.waitForTimeout(2000);
  const cont = cp.getByRole("button", { name: "Continue" });
  if (await cont.isEnabled({ timeout: 1000 }).catch(() => false)) await cont.click({ timeout: 3000 }).catch(() => undefined);
  await cp.waitForTimeout(1500);
  await shot(cp, "04a-caller-after-check");
  const c = { page: cp, ...who };
  const t0 = Date.now() - 1000;
  await c.page.getByRole("button", { name: "Send me a code" }).click();
  await expect(c.page.getByLabel("Code", { exact: true })).toBeVisible();
  await c.page.getByLabel("Code", { exact: true }).fill("48");
  await shot(c.page, "04-caller-confirm");
  await c.page.getByLabel("Code", { exact: true }).fill(await emailCode(c.page.request, c.email, t0, "to reach"));
  await c.page.getByRole("button", { name: "Confirm code" }).click();
  await c.page.getByLabel("Add a short note").fill("Hi, I got your code at the careers day. I'd like to ask about the internship.");
  await c.page.getByRole("button", { name: "Send request" }).click();
  await expect(c.page.getByRole("heading", { name: "Waiting for the owner" })).toBeVisible();
  await shot(c.page, "05-caller-waiting");

  await page.goto("/dashboard");
  await expect(page.getByTestId("requests-banner")).toBeVisible();
  await shot(page, "01-home");

  await page.goto("/dashboard/requests");
  const card = page.getByTestId("request-card").first();
  await expect(card).toContainText(`@${c.handle} wants to reach you`);
  await shot(page, "03-requests");
  await card.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(/Undo · \d/)).toBeVisible();
  await shot(page, "03b-requests-undo");

  await c.page.getByRole("button", { name: /Chat in the app/ }).click({ timeout: 20_000 });
  await expect(c.page).toHaveURL(/\/chats\/[0-9a-f-]{36}/);
  await c.page.getByLabel("Message", { exact: true }).fill("Hi, thanks for approving!");
  await c.page.getByRole("button", { name: "Send", exact: true }).click();
  // The caller sends a view-once photo (a small generated PNG).
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAJUlEQVR42u3OMQEAAAgDoK1/aFOMBwYgfDipi4qKioqKioqKiooqJKIBIJ8lMLEAAAAASUVORK5CYII=", "base64");
  await c.page.getByRole("button", { name: "Attach a photo or your contact code" }).click();
  await c.page.getByRole("button", { name: /View once: off/ }).click();
  const chooser = c.page.waitForEvent("filechooser");
  await c.page.getByRole("button", { name: "Send a view-once photo" }).click();
  await (await chooser).setFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
  await expect(c.page.locator(".bubble.mine .msg-attach, .bubble.mine img").first()).toBeVisible();
  await page.goto(c.page.url().replace(/^https?:\/\/[^/]+/, ""));
  await expect(page.getByText("Photo · view once")).toBeVisible();
  await page.getByLabel("Message", { exact: true }).fill("Sure, how can I help?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Sure, how can I help?")).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, "06-chat-owner");
  await c.page.reload(); await expect(c.page.getByText("Sure, how can I help?")).toBeVisible();
  await shot(c.page, "07-chat-caller");
});
