/**
 * Walks through PryingEyes as real people would and saves a screenshot of each critical screen,
 * for the system documentation. Website shots are 1280×800 (desktop) and the app's are 412×915
 * (a typical Android phone), both at 2× pixel density.
 */
import { test, expect, request as pwRequest, type Browser, type Page } from "@playwright/test";
import { callerOpens, createToken, emailSignUp, outbox, ownerOnboard, rnd } from "../e2e/util";

import fs from "node:fs";
import Redis from "ioredis";

const OUT = process.env.SHOTS_DIR ?? "docs/latex/screens";
/**
 * The handle-suggestion endpoint allows 60 requests a minute per address, which a scripted
 * walkthrough exceeds in seconds. Reset that counter (development Redis only) between sign-ups.
 */
async function resetHandleLimit() {
  const url = fs.readFileSync(".env", "utf8").match(/^REDIS_URL=(.*)$/m)?.[1] ?? "redis://127.0.0.1:6380/0";
  const r = new Redis(url.replace(/^"|"$/g, ""));
  const keys = await r.keys("rl:handle:*");
  if (keys.length) await r.del(...keys);
  r.disconnect();
}
const WEB = "http://localhost:3000", APP = "http://localhost:8081";
const shot = (p: Page, name: string, full = false) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full, animations: "disabled" });
const settle = (p: Page) => p.waitForTimeout(600);   // let fonts and polling settle

async function desktop(browser: Browser) {
  return (await browser.newContext({ baseURL: WEB, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, permissions: ["microphone"] })).newPage();
}
async function phone(browser: Browser) {
  return (await browser.newContext({ baseURL: APP, viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36", permissions: ["microphone"] })).newPage();
}

/** App: sign up by email from wherever the sign-up screen was opened, confirm, sign in. */
async function appSignUp(app: Page) {
  const email = `app_${rnd()}@example.test`, password = "correct horse battery staple";
  await app.getByTestId("email").fill(email);
  await app.getByTestId("password").fill(password);
  await expect(app.getByTestId("handle")).toHaveValue(/^[a-z]+_[a-z]+_\d{2,}$/);
  const handle = await app.getByTestId("handle").inputValue();
  await app.getByRole("checkbox").click();
  await app.getByTestId("signup-submit").click();
  await expect(app.getByText("Check your email")).toBeVisible();
  const server = await pwRequest.newContext({ baseURL: WEB });
  const mail = await outbox(server, (m) => m.channel === "email" && m.to === email && m.body.includes("verify-email"));
  const token = mail.body.match(/token=([\w-]+)/)[1];
  expect((await server.post(`/api/auth/verify-email`, { data: { token }, headers: { "X-PE-Client": "mobile" } })).ok()).toBe(true);
  await app.getByTestId("go-signin-after").click();
  await app.getByTestId("email").fill(email);
  await app.getByTestId("password").fill(password);
  await app.getByTestId("signin-submit").click();
  return { email, handle };
}

test("website: the critical screens", async ({ browser }) => {
  // Public pages.
  const visitor = await desktop(browser);
  await visitor.goto("/"); await settle(visitor); await shot(visitor, "web-01-home");
  await visitor.goto("/signup"); await expect(visitor.getByLabel("Handle")).toHaveValue(/_/); await settle(visitor); await shot(visitor, "web-02-signup");

  // An owner with codes.
  const owner = await desktop(browser);
  await ownerOnboard(owner);
  await owner.goto("/dashboard/tokens/new");
  await owner.getByLabel("Name", { exact: true }).fill("Car for sale");
  await settle(owner); await shot(owner, "web-03-new-code");
  const car = await createToken(owner, { context: "Classifieds", tier: 1, label: "Car for sale", number: false });
  await settle(owner); await shot(owner, "web-04-share-code");
  const room = await createToken(owner, { context: "Marketplace", tier: 3, label: "Room to rent", number: false });

  // A caller reaches the owner through the car code.
  const callerCtx = await browser.newContext({ baseURL: WEB, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, permissions: ["microphone"] });
  const signedOut = await callerCtx.newPage();
  await signedOut.goto(car.link.replace(/^https?:\/\/[^/]+/, ""));
  await expect(signedOut.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
  await settle(signedOut); await shot(signedOut, "web-05-gate-signed-out");
  await signedOut.close();
  await resetHandleLimit();
  const c = await callerOpens(callerCtx, car.link);
  await expect(c.page.getByRole("button", { name: /Chat in the app/ })).toBeVisible();
  await settle(c.page); await shot(c.page, "web-06-gate-choose");
  await c.page.getByRole("button", { name: /Chat in the app/ }).click();
  await c.page.getByLabel("Message").fill("Hi! Is the car still for sale?");
  await c.page.getByRole("button", { name: "Send" }).click();

  // The owner answers and shares a one-person code in the chat.
  await owner.goto("/chats");
  await owner.getByRole("link", { name: `@${c.handle}` }).click();
  await owner.getByLabel("Message").fill("Yes, it is. My brother is selling his too:");
  await owner.getByTestId("chat-share-code").click();
  await owner.getByRole("button", { name: "Send" }).click();
  await expect(c.page.getByTestId("chat-code").last()).toBeVisible({ timeout: 10_000 });
  await settle(c.page); await shot(c.page, "web-07-chat");

  // In-app call ringing (caller side).
  await c.page.getByRole("button", { name: /Call in the app/ }).click();
  await expect(c.page).toHaveURL(/\/calls\//);
  await expect(c.page.getByTestId("call-status")).toContainText(/Ringing|Calling/);
  await settle(c.page); await shot(c.page, "web-08-call");
  await c.page.getByTestId("hangup").click({ timeout: 5000 }).catch(() => undefined);
  await c.page.close();

  await resetHandleLimit();
  // A Tier 3 request waiting for the owner.
  const c3 = await callerOpens(await browser.newContext({ baseURL: WEB, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }), room.link);
  const t0 = Date.now() - 1000;
  await c3.page.getByRole("button", { name: "Send me a code" }).click();
  const code = (await outbox(c3.page.request, (m) => m.channel === "email" && m.to === c3.email && new Date(m.createdAt).getTime() >= t0 && /\b\d{6}\b/.test(m.body))).body.match(/\b(\d{6})\b/)[1];
  await c3.page.getByLabel("Code", { exact: true }).fill(code);
  await c3.page.getByRole("button", { name: "Confirm code" }).click();
  await c3.page.getByLabel("Add a short note").fill("Hello, I'm a student at UNESWA looking for a room from January.");
  await c3.page.getByRole("button", { name: "Send request" }).click();
  await expect(c3.page.getByRole("heading", { name: "Waiting for the owner" })).toBeVisible();
  await owner.goto("/dashboard/requests");
  await expect(owner.getByTestId("request-card").first()).toBeVisible();
  await settle(owner); await shot(owner, "web-09-requests");

  // Groups: a post with a code, a refused number, and someone asking to join.
  await owner.goto("/groups");
  await owner.getByTestId("group-name").fill("Manzini Market");
  await expect(async () => { await owner.getByTestId("group-create").click(); await expect(owner).toHaveURL(/\/groups\/[0-9a-f-]{36}/, { timeout: 2000 }); }).toPass();
  const groupPath = new URL(owner.url()).pathname;
  const invite = (await owner.getByTestId("invite-link").innerText()).trim();
  await owner.getByTestId("composer-input").fill("Selling a fridge, E1,500. Collect in Manzini this weekend.");
  await owner.getByTestId("attach-code").click();
  await owner.getByRole("button", { name: "Open", exact: true }).click();
  await owner.getByTestId("composer-send").click();
  await expect(owner.locator(".code-card")).toBeVisible();
  const asker = await desktop(browser);
  await asker.goto(invite.replace(/^https?:\/\/[^/]+/, ""));
  await resetHandleLimit();
  await asker.getByRole("link", { name: "Create an account" }).click();
  await emailSignUp(asker);
  await asker.getByLabel("A note for the admins (optional)").fill("Thandi from Fairview, I sell vegetables");
  await asker.getByTestId("join-confirm").click();
  await expect(asker.getByTestId("join-requested")).toBeVisible();
  await owner.goto(groupPath);
  await expect(owner.getByTestId("join-request")).toBeVisible();
  await owner.getByTestId("composer-input").fill("Call me on 7612 3456 for delivery");
  await owner.getByTestId("composer-send").click();
  await expect(owner.locator(".alert.warn")).toBeVisible();
  await settle(owner); await shot(owner, "web-10-group");
  await owner.getByTestId("composer-input").fill("");
  await owner.goto("/groups");
  await owner.getByTestId("group-search").fill("Market");
  await owner.getByRole("button", { name: "Search" }).click();
  await settle(owner); await shot(owner, "web-11-groups");
  await owner.goto("/settings"); await settle(owner); await shot(owner, "web-12-settings");
});

test("phone app: the critical screens", async ({ browser }) => {
  // An owner on the website makes a code and a group with a post.
  const owner = await desktop(browser);
  await ownerOnboard(owner);
  const bakkie = await createToken(owner, { context: "Business", tier: 1, label: "Bakkie for hire", number: false });
  await owner.goto("/groups");
  await owner.getByTestId("group-name").fill(`Mbabane Runners ${rnd()}`);
  await expect(async () => { await owner.getByTestId("group-create").click(); await expect(owner).toHaveURL(/\/groups\/[0-9a-f-]{36}/, { timeout: 2000 }); }).toPass();
  const groupPath = new URL(owner.url()).pathname;
  const invite = (await owner.getByTestId("invite-link").innerText()).trim();
  await owner.getByTestId("composer-input").fill("Saturday long run from Coronation Park, 6am. Message me to join the pacing group.");
  await owner.getByTestId("attach-code").click();
  await owner.getByTestId("composer-send").click();
  await expect(owner.locator(".code-card")).toBeVisible();

  const app = await phone(browser);
  await app.goto("/"); await expect(app.getByTestId("go-signup")).toBeVisible(); await settle(app); await shot(app, "app-01-start");

  // Opening the bakkie code, signing up from its gate, and landing back on it.
  await app.getByTestId("code-input").fill(bakkie.short);
  await app.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(app.getByTestId("gate-signup")).toBeVisible();
  await settle(app); await shot(app, "app-02-gate-signed-out");
  await resetHandleLimit();
  await app.getByTestId("gate-signup").click();
  await settle(app); await shot(app, "app-03-signup");
  const me = await appSignUp(app);
  await expect(app.getByText("You're trying to reach")).toBeVisible();
  await app.getByRole("checkbox").click();
  await app.getByTestId("gate-continue").click();
  await expect(app.getByTestId("opt-chat")).toBeVisible();
  await settle(app); await shot(app, "app-04-gate-choose");
  await app.getByTestId("opt-chat").click();
  await app.getByTestId("message-input").fill("Hello! Is the bakkie free on Saturday?");
  await app.getByTestId("send").click();
  await owner.goto("/chats");
  await owner.getByRole("link", { name: `@${me.handle}` }).click();
  await owner.getByLabel("Message").fill("Yes it is. If it's taken, try my cousin:");
  await owner.getByTestId("chat-share-code").click();
  await owner.getByRole("button", { name: "Send" }).click();
  await expect(app.getByTestId("chat-code").last()).toBeVisible({ timeout: 10_000 });
  await settle(app); await shot(app, "app-05-chat");

  // The person's own codes.
  await app.goto("/home");
  await app.getByTestId("new-token").click();
  await app.getByTestId("token-label").fill("Braiding appointments");
  await settle(app); await shot(app, "app-06-new-code");
  await app.getByTestId("create-token").click();
  await expect(app.getByText("Ready to share")).toBeVisible();
  await settle(app); await shot(app, "app-07-share-code");
  await app.getByRole("button", { name: "Done" }).click();
  await settle(app); await shot(app, "app-08-home");

  // Groups: ask to join by invite; the owner approves; the feed; asking to join someone else's group.
  await app.goto(invite.replace(/^https?:\/\/[^/]+/, ""));
  await app.getByTestId("join-confirm").click();
  await expect(app.getByText("You've asked to join")).toBeVisible();
  await owner.goto(groupPath);
  await owner.getByTestId("join-request").getByTestId("approve-join").click();
  await expect(owner.getByTestId("join-request")).toHaveCount(0);
  await app.goto(`/group/${groupPath.split("/").pop()}`);
  await expect(app.getByTestId("post").first()).toBeVisible();
  await settle(app); await shot(app, "app-09-group");
  await app.goto("/groups"); await settle(app); await shot(app, "app-10-groups");
  // The app user's own group, with a request waiting for them to approve.
  await app.goto("/group/new");
  await app.getByTestId("group-name").fill("Braiders of Manzini");
  await app.getByTestId("group-create").click();
  await expect(app.getByText("Invite link", { exact: true })).toBeVisible();
  const myInvite = (await app.getByTestId("invite-link").innerText()).trim();
  const asker = await desktop(browser);
  await resetHandleLimit();
  await asker.goto(myInvite.replace(/^https?:\/\/[^/]+/, "").replace(/^\/?/, "/"));
  await asker.getByRole("link", { name: "Create an account" }).click();
  await emailSignUp(asker);
  await asker.getByLabel("A note for the admins (optional)").fill("I'm a braider in Manzini town");
  await asker.getByTestId("join-confirm").click();
  await expect(asker.getByTestId("join-requested")).toBeVisible();
  await app.reload();
  await expect(app.getByTestId("join-request")).toBeVisible();
  await settle(app); await shot(app, "app-11-group-requests");
});
