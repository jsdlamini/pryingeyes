import { test, expect, request as pwRequest, type APIRequestContext, type Page } from "@playwright/test";
import { createToken, ownerOnboard, rnd } from "../e2e/util";
import { totpAt } from "../../src/lib/totp";

const WEB = "http://localhost:3000";
let server: APIRequestContext;
test.beforeAll(async () => { server = await pwRequest.newContext({ baseURL: WEB }); });
test.afterAll(async () => { await server.dispose(); });

async function outbox(match: (m: any) => boolean) {
  for (let i = 0; i < 30; i++) {
    const { messages } = await (await server.get("/api/dev/outbox")).json();
    const m = messages.find(match);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("message not in dev outbox");
}
/**
 * App: a new person on the sign-up screen (reached from a gate or invite). Signs up by email,
 * confirms through the link (as tapping it in the email would), and signs in. They land back on
 * the code or invite they were opening.
 */
async function appSignUp(app: Page) {
  const email = `app_${rnd()}@example.test`, password = "correct horse battery staple";
  await app.getByTestId("email").fill(email);
  await app.getByTestId("password").fill(password);
  await expect(app.getByTestId("handle")).toHaveValue(/^[a-z]+_[a-z]+_\d{2,}$/);
  const handle = await app.getByTestId("handle").inputValue();
  await app.getByRole("checkbox").click();
  await app.getByTestId("signup-submit").click();
  await expect(app.getByText("Check your email")).toBeVisible();
  const mail = await outbox((m) => m.channel === "email" && m.to === email && m.body.includes("verify-email"));
  const token = mail.body.match(/token=([\w-]+)/)[1];
  expect((await server.post("/api/auth/verify-email", { data: { token }, headers: { "X-PE-Client": "mobile" } })).ok()).toBe(true);
  await app.getByTestId("go-signin-after").click();
  await app.getByTestId("email").fill(email);
  await app.getByTestId("password").fill(password);
  await app.getByTestId("signin-submit").click();
  return { email, handle };
}

/** App: opens a code, signs up by email from its gate, comes back to it, and passes the human check. */
async function appCallerOpens(app: Page, code: string) {
  await app.goto("/");
  await app.getByTestId("code-input").fill(code);
  await app.getByRole("button", { name: "Continue", exact: true }).click();
  await app.getByTestId("gate-signup").click();
  const { email, handle } = await appSignUp(app);
  await expect(app.getByText("You're trying to reach")).toBeVisible();
  await app.getByRole("checkbox").click();
  await app.getByTestId("gate-continue").click();
  return { handle, email };
}

test("App caller reaches a web owner: chat both ways, then an in-app call through the relay", async ({ page: app, browser }) => {
  const ownerCtx = await browser.newContext({ baseURL: WEB, permissions: ["microphone"], viewport: { width: 1200, height: 900 } });
  const owner = await ownerCtx.newPage();
  await ownerOnboard(owner);
  const { short } = await createToken(owner, { context: "Business", tier: 1, label: "Bakkie for sale" });

  const { handle } = await appCallerOpens(app, short);
  await expect(app.getByTestId("gate-label")).toHaveText("Bakkie for sale");
  await app.getByTestId("opt-chat").click();
  await app.getByTestId("message-input").fill("Hi, is the bakkie still available?");
  await app.getByTestId("send").click();
  await expect(app.getByTestId("bubble-mine")).toContainText("still available");

  await owner.goto("/chats");
  await owner.getByRole("link", { name: `@${handle}` }).click();
  await expect(owner.locator(".bubble.theirs")).toContainText("still available");
  await owner.getByLabel("Message").fill("Yes. Call me in the app?");
  await owner.getByRole("button", { name: "Send" }).click();
  await expect(app.getByTestId("bubble-theirs")).toContainText("Call me in the app", { timeout: 10_000 });
  expect(await app.content()).not.toMatch(/\+268\d{8}/);

  // Call from the app; the owner's website rings and answers. Relay-only ICE, so "Connected" means audio via TURN.
  await owner.goto("/dashboard");
  await app.getByTestId("chat-call").click();
  await expect(app.getByTestId("call-status")).toContainText(/Ringing/);
  const banner = owner.getByRole("alertdialog");
  await expect(banner).toContainText(`@${handle} is calling`, { timeout: 10_000 });
  await banner.getByRole("button", { name: "Answer" }).click();
  await expect(owner.getByTestId("call-status")).toHaveText("Connected", { timeout: 25_000 });
  await expect(app.getByTestId("call-status")).toHaveText("Connected", { timeout: 25_000 });
  await expect.poll(() => app.evaluate(() => {
    const s = (document.querySelector('[data-testid="remote-audio"]') as HTMLAudioElement | null)?.srcObject as MediaStream | null;
    return !!s && s.getAudioTracks().some((t) => t.readyState === "live");
  })).toBe(true);
  await app.waitForTimeout(1500);
  await app.getByTestId("hangup").click();
  await expect(app.getByTestId("call-status")).toHaveText("Call ended");
  await expect(owner.getByTestId("call-status")).toHaveText("Call ended", { timeout: 10_000 });
  await ownerCtx.close();
});

test("Owner on the app: sign up, create a code straight away; adding a number to show is optional", async ({ page: app }) => {
  const email = `app_owner_${rnd()}@example.test`;
  await app.goto("/");
  await app.getByTestId("go-signup").click();
  await app.getByTestId("email").fill(email);
  await app.getByTestId("password").fill("correct horse battery staple");
  await expect(app.getByTestId("handle")).toHaveValue(/^[a-z]+_[a-z]+_\d{2,}$/);
  await app.getByRole("checkbox").click();
  await app.getByTestId("signup-submit").click();
  await expect(app.getByText("Check your email")).toBeVisible();

  // Confirm the email the way the link in it would.
  const mail = await outbox((m) => m.channel === "email" && m.to === email);
  const token = mail.body.match(/token=([\w-]+)/)[1];
  expect((await server.post("/api/auth/verify-email", { data: { token }, headers: { "X-PE-Client": "mobile" } })).ok()).toBe(true);

  await app.getByRole("button", { name: "Go to sign in" }).click();
  await app.getByTestId("email").fill(email);
  await app.getByTestId("password").fill("correct horse battery staple");
  await app.getByTestId("signin-submit").click();

  // No number, no two-step sign-in: create a code right away.
  await app.getByTestId("new-token").click();
  await app.getByTestId("token-label").fill("Fridge");
  await app.getByRole("button", { name: "Classifieds" }).click();
  await app.getByTestId("tier-1").click();
  await expect(app.getByText("Show my number (optional)")).toHaveCount(0);
  if (process.env.SHOTS) await app.screenshot({ path: `${process.env.SHOTS}/app-new-code.png`, fullPage: true });
  await app.getByTestId("create-token").click();
  await expect(app.getByText("Ready to share")).toBeVisible();
  await expect(app.getByTestId("share-link")).toContainText("/t/");
  await expect(app.getByTestId("share-short")).toHaveText(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
  await app.getByRole("button", { name: "Done" }).click();
  await expect(app.getByTestId("token-Fridge")).toBeVisible();

  // Optional: add a number that approved people may see once. This needs two-step sign-in first.
  await app.goto("/onboarding");
  await app.getByTestId("totp-begin").click();
  const secret = (await app.getByTestId("totp-secret").innerText()).trim();
  await app.getByTestId("totp-confirm-code").fill(totpAt(secret, Date.now()));
  await app.getByTestId("totp-confirm").click();
  await expect(app.getByText("Save your recovery codes")).toBeVisible();
  await app.getByRole("checkbox").click();
  await app.getByRole("button", { name: "Continue" }).click();
  await app.getByTestId("protect-phone").fill("+27 82 555 0199");     // pasted international number switches the country
  await expect(app.getByTestId("protect-phone")).toHaveValue("082 555 0199");
  await app.getByTestId("add-number").click();
  await expect(app.getByText("Added: Personal mobile ending ··99")).toBeVisible();
  await app.getByTestId("onboard-new-token").click();
  await app.getByTestId("token-label").fill("Bakkie");
  await app.getByRole("button", { name: /Personal mobile ··99/ }).click();
  await app.getByTestId("create-token").click();
  await expect(app.getByText("Ready to share")).toBeVisible();
});

test("Groups in the app: join from an invite link, numbers are refused, a contact code opens the gate already filled in", async ({ page: app, browser }) => {
  // Owner on the website starts a group and posts with a contact code.
  const ownerCtx = await browser.newContext({ baseURL: WEB, viewport: { width: 1200, height: 900 } });
  const owner = await ownerCtx.newPage();
  await ownerOnboard(owner);
  await owner.goto("/groups");
  const name = `Lobamba Traders ${rnd()}`;
  await owner.getByTestId("group-name").fill(name);
  await expect(async () => { await owner.getByTestId("group-create").click(); await expect(owner).toHaveURL(/\/groups\/[0-9a-f-]{36}/, { timeout: 2000 }); }).toPass();
  const invite = (await owner.getByTestId("invite-link").innerText()).trim();
  const groupPath = new URL(owner.url()).pathname;
  await owner.getByTestId("composer-input").fill("Fresh bread every morning");
  await owner.getByTestId("attach-code").click();
  await owner.getByRole("button", { name: "Open", exact: true }).click();
  await owner.getByTestId("composer-send").click();
  await expect(owner.locator(".code-card")).toContainText("Your contact code");

  // The invite link opens the app's join screen (App Links / Universal Links in a real install).
  await app.goto(invite.replace(/^https?:\/\/[^/]+/, ""));
  await app.getByTestId("join-signup").click();
  await appSignUp(app);
  await expect(app.getByTestId("join-name")).toHaveText(name);
  await app.getByTestId("join-confirm").click();
  await expect(app.getByText("You've asked to join")).toBeVisible();

  // The creator lets them in from the website.
  await owner.goto(groupPath);
  await owner.getByTestId("join-request").getByTestId("approve-join").click();
  await expect(owner.getByTestId("join-request")).toHaveCount(0);
  await app.goto(`/group/${groupPath.split("/").pop()}`);

  // In the group: a number is refused with a pointer to contact codes.
  await expect(app.getByTestId("post").first()).toContainText("Fresh bread");
  await app.getByTestId("composer-input").fill("Deliver to me, my number is 76 12 34 56");
  await app.getByTestId("composer-send").click();
  await expect(app.getByText(/looks like it contains a phone number/)).toBeVisible();
  if (process.env.SHOTS) await app.screenshot({ path: `${process.env.SHOTS}/app-group.png` });

  // Tapping the owner's code opens the gate with the code in place.
  await app.getByTestId("code-card").click();
  await expect(app.getByText("You're trying to reach")).toBeVisible();
  await app.getByRole("checkbox").click();
  await app.getByTestId("gate-continue").click();
  await expect(app.getByTestId("gate-label")).toHaveText(`Group: ${name}`.slice(0, 40));
  await app.getByTestId("opt-chat").click();
  await expect(app.getByTestId("message-input")).toBeVisible();
  expect(await app.content()).not.toMatch(/\+268\d{8}/);

  // A code link (https://<server>/t/<code>) also lands on the gate inside the app.
  const link = await owner.locator(".code-card").count();
  expect(link).toBe(1);
  await app.goto("/t/ABCDE-FGHJK");
  await expect(app.getByText("You're trying to reach")).toBeVisible();
  await ownerCtx.close();
});
