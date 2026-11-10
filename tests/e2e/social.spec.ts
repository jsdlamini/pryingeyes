import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { callerOpens, createToken, emailCode, emailSignUp, ownerOnboard } from "./util";

test.describe.configure({ mode: "serial" });

test("Groups: numbers are refused, contact codes are shared, and tapping one opens the gate with it filled in", async ({ page, browser }) => {
  const owner = await ownerOnboard(page);

  // Owner starts a group.
  await page.goto("/groups");
  await page.getByTestId("group-name").fill("Manzini Market");
  await expect(async () => { await page.getByTestId("group-create").click(); await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}/, { timeout: 2000 }); }).toPass();
  const invite = (await page.getByTestId("invite-link").innerText()).trim();
  const groupPath = new URL(page.url()).pathname;
  expect(invite).toMatch(/\/g\/[0-9A-Z-]{14}$/);

  // Typing a phone number is refused, and the composer switches to attaching a code.
  await page.getByTestId("composer-input").fill("Fridge for sale, whatsapp me on 7612 3456");
  await page.getByTestId("composer-send").click();
  await expect(page.locator(".alert.warn")).toContainText("Attach your contact code instead");
  await expect(page.getByTestId("attach-code")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("composer-input").fill("Fridge for sale, E1,500. Collect in Manzini.");
  await page.getByTestId("composer-send").click();
  await expect(page.getByTestId("post")).toContainText("Fridge for sale");
  await expect(page.locator(".code-card")).toContainText("Your contact code");
  await expect(page.locator("main")).not.toContainText(owner.phone.slice(4));

  // Owner's status, with a code.
  await page.goto("/groups");
  await page.getByTestId("status-mine").click();
  await page.getByTestId("composer-input").fill("Open today until 5");
  await page.getByTestId("attach-code").click();
  await page.getByTestId("composer-send").click();
  await expect(page.getByTestId("status-mine")).toContainText("You");

  // A member opens the invite link, signs up by email, and asks to join with a note.
  const ctx = await browser.newContext();
  const m = await ctx.newPage();
  await m.goto(invite.replace(/^https?:\/\/[^/]+/, ""));
  await expect(m).toHaveURL(/\/login\?next=%2Fg%2F/);
  await m.getByRole("link", { name: "Create an account" }).click();
  const member = await emailSignUp(m);
  await expect(m.getByTestId("join-name")).toHaveText("Manzini Market");
  await m.getByLabel("A note for the admins (optional)").fill("Thandi, I sell vegetables");
  await m.getByTestId("join-confirm").click();
  await expect(m.getByTestId("join-requested")).toBeVisible();

  // Only the creator (an admin) lets them in.
  await page.goto("/groups");
  await expect(page.getByTestId("requests-badge")).toHaveText("1");
  await page.goto(groupPath);
  const req = page.getByTestId("join-request");
  await expect(req).toContainText(`@${member.handle}`);
  await expect(req).toContainText("Thandi, I sell vegetables");
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/web-join-requests.png` });
  await req.getByTestId("approve-join").click();
  await expect(page.getByTestId("join-request")).toHaveCount(0);
  await m.goto(groupPath);
  await expect(m.getByRole("heading", { name: "Manzini Market" })).toBeVisible();

  // The member can't post a number either, even disguised.
  await m.getByTestId("composer-input").fill("Is it available? Call seven six one two three four five six");
  await m.getByTestId("composer-send").click();
  await expect(m.locator(".alert.warn")).toContainText("phone number");
  await m.getByTestId("composer-input").fill("Is it still available?");
  await m.getByTestId("composer-send").click();
  await expect(m.getByTestId("post").first()).toContainText("still available");

  // The owner's status shows for the member (they share a group).
  await m.goto("/groups");
  await expect(m.getByTestId("status-person")).toContainText(`@${owner.handle}`);

  // Tapping the code opens the gate with the code already in place: no copy and paste.
  await m.getByRole("link", { name: "Manzini Market" }).click();
  await expect(m.getByRole("heading", { name: "Manzini Market" })).toBeVisible();   // the group page is up before we tap its code
  await m.getByTestId("code-card").click();
  await expect(m).toHaveURL(/\/t\/[0-9A-Z]+/);
  await expect(m.getByText("You're trying to reach")).toBeVisible();
  await m.getByLabel(/I'm a person, not a bot/).check();
  await m.getByRole("button", { name: "Continue" }).click();
  await expect(m.getByRole("heading", { name: "Group: Manzini Market" })).toBeVisible();
  // Tier 2 (the composer's default): the member confirms a code emailed to them.
  const t1 = Date.now() - 1000;
  await m.getByRole("button", { name: /Text me a code|Send me a code/ }).click();
  await m.getByLabel("Code", { exact: true }).fill(await emailCode(m.request, member.email, t1, "to reach"));
  await m.getByRole("button", { name: /Confirm|Verify/ }).click();
  await m.getByRole("button", { name: "Chat in the app" }).click();
  await expect(m).toHaveURL(/\/chats\/[0-9a-f-]{36}/);
  await expect(m.locator("body")).not.toContainText(owner.phone.slice(4));

  const r = await new AxeBuilder({ page: m }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await m.goto("/groups");
  const r2 = await new AxeBuilder({ page: m }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(r2.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} ${v.nodes[0]?.target}`)).toEqual([]);
  await ctx.close();
});

test("No phone number needed: sign up by email, create a code, and be reached by message or in-app call only", async ({ page, browser }) => {
  await page.goto("/signup");
  await emailSignUp(page);
  await expect(page.getByRole("heading", { name: "My codes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add a phone number" })).toBeVisible();   // optional, not required
  const { link } = await createToken(page, { context: "Business", tier: 1, label: "Hair braiding", number: false });
  await expect(page.getByLabel("Show my number (optional)")).toHaveCount(0);

  const ctx = await browser.newContext();
  const c = await callerOpens(ctx, link);
  await expect(c.page.getByRole("heading", { name: "Hair braiding" })).toBeVisible();
  await expect(c.page.getByRole("button", { name: /Call in the app/ })).toBeVisible();
  await expect(c.page.getByRole("button", { name: /Chat in the app/ })).toBeVisible();
  await expect(c.page.getByRole("button", { name: "Show the number" })).toHaveCount(0);
  await c.page.getByRole("button", { name: /Chat in the app/ }).click();
  await expect(c.page).toHaveURL(/\/chats\/[0-9a-f-]{36}/);
  await ctx.close();
});

test("Find a group, ask to join, and a code shared in a chat opens the gate for whoever taps it", async ({ page, browser }) => {
  // An owner starts a listed group, and makes a code so someone can reach them in a chat.
  await ownerOnboard(page);
  await page.goto("/groups");
  const name = `Lobamba Runners ${Math.random().toString(36).slice(2, 6)}`;
  await page.getByTestId("group-name").fill(name);
  await expect(async () => { await page.getByTestId("group-create").click(); await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}/, { timeout: 2000 }); }).toPass();
  const groupPath = new URL(page.url()).pathname;
  const { link } = await createToken(page, { context: "Business", tier: 1, label: "Running kit", number: false });

  // Someone finds it in search and asks to join; they can't see posts until approved.
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await a.goto("/signup");
  const asker = await emailSignUp(a);
  await a.goto("/groups");
  await a.getByTestId("group-search").fill(name);
  await a.getByRole("button", { name: "Search" }).click();
  await expect(a.getByTestId("found-group")).toContainText(name);
  await a.getByTestId("ask-join").click();
  await expect(a.getByTestId("found-group")).toContainText("Asked");
  await expect(a.getByTestId("pending")).toContainText(name);
  await a.goto(groupPath);
  await expect(a.getByRole("heading", { name })).toHaveCount(0);

  await page.goto(groupPath);
  await page.getByTestId("join-request").getByTestId("approve-join").click();
  await a.goto(groupPath);
  await expect(a.getByRole("heading", { name })).toBeVisible();

  // The asker reaches the owner through a code, and in the chat the owner shares a one-person code.
  const c = await callerOpens(await browser.newContext(), link);
  await c.page.getByRole("button", { name: /Chat in the app/ }).click();
  await expect(c.page).toHaveURL(/\/chats\/[0-9a-f-]{36}/);
  await c.page.getByLabel("Message").fill("Hi, do you have size 9 shoes?");
  await c.page.getByRole("button", { name: "Send" }).click();
  await page.goto("/chats");
  await page.getByRole("link", { name: `@${c.handle}` }).click();
  await page.getByTestId("chat-share-code").click();
  await expect(page.getByTestId("share-code-panel")).toBeVisible();
  await page.getByLabel("Message").fill("Ask my partner, she has them:");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".bubble.mine").last()).toContainText("Your contact code");
  // On the other side it's a tappable code that opens the gate with it filled in.
  const chip = c.page.getByTestId("chat-code").last();
  await expect(chip).toBeVisible({ timeout: 10_000 });
  if (process.env.SHOTS) await c.page.screenshot({ path: `${process.env.SHOTS}/web-chat-code.png` });
  await chip.click();
  await expect(c.page).toHaveURL(/\/t\/[0-9A-Z]+/);
  await expect(c.page.getByText("You're trying to reach")).toBeVisible();
  void asker;
  await ctx.close();
});

test("@mobile a code link offers to open the app", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phones only");
  await page.goto("/t/ABCDE-FGHJK");
  await expect(page.getByTestId("open-in-app")).toHaveAttribute("href", "pryingeyes://t/ABCDE-FGHJK");
});

test("App-link files are served for Android and iOS", async ({ request }) => {
  const a = await request.get("/.well-known/assetlinks.json");
  expect(a.headers()["content-type"]).toContain("application/json");
  expect(Array.isArray(await a.json())).toBe(true);
  const i = await request.get("/.well-known/apple-app-site-association");
  expect((await i.json()).applinks).toBeTruthy();
});
