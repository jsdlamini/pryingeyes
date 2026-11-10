import { chromium } from "playwright-core";
import fs from "node:fs";

const WEB = "http://localhost:3000";
const OUT = "/home/z/my-project/download/screenshots";
fs.mkdirSync(OUT, { recursive: true });
const rnd = Math.random().toString(36).slice(2, 6);
const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled", fullPage: false, ...opts });
async function fillComposer(page, text) {
  // A React re-mount can wipe a fill that landed before hydration; verify it stuck.
  const input = page.getByTestId("composer-input");
  for (let i = 0; i < 6; i++) {
    await input.fill(text);
    await page.waitForTimeout(300);
    if ((await input.inputValue().catch(() => "")) === text) return;
  }
  throw new Error("composer input would not hold text: " + text);
}
async function submitComposer(page, expected) {
  // Click-and-verify: a re-render can detach the button between resolve and click.
  try { await page.getByTestId("composer-send").click({ timeout: 4000 }); } catch (e) { console.log("click failed:", e.message.split("\n")[0]); }
  try { await page.waitForSelector(`text=${expected}`, { timeout: 10000 }); }
  catch (e) { await shot(page, "debug-submit"); console.log("URL:", page.url()); console.log("BODY:", (await page.locator("main").innerText()).slice(0, 800)); throw e; }
}

const pageErrors = [];
const browser = await chromium.launch({ headless: true,
  executablePath: "/home/z/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell" });

async function newUser(suffix) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(suffix + ": " + e.message));
  const email = `demo_${suffix}_${rnd}@example.test`, password = "correct horse battery staple";
  await page.goto(`${WEB}/signup`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  try {
    await page.waitForFunction(() => { const el = document.getElementById("handle"); return el && el.value.length > 3; }, { timeout: 30000 });
  } catch (e) {
    console.log("SIGNUP FAIL:", suffix, "| url:", page.url());
    console.log("HANDLE:", JSON.stringify(await page.locator("#handle").inputValue().catch(() => "?")));
    console.log("BODY HEAD:", (await page.locator("main").innerText().catch(() => "?")).slice(0, 300));
    console.log("PAGEERRORS:", pageErrors.slice(-4).join(" || ").slice(0, 900));
    await shot(page, "debug-signup-" + suffix);
    throw e;
  }
  const handle = await page.getByLabel("Handle").inputValue();
  await page.getByLabel(/I'm 18 or older/).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForSelector("text=Check your email");
  let link = "";
  for (let i = 0; i < 30 && !link; i++) {
    const r = await page.request.get(`${WEB}/api/dev/outbox`); const { messages } = await r.json();
    const m = messages.find((x) => x.to === email && x.body.includes("verify-email"));
    if (m) link = m.body.match(/https?:\/\/\S+/)[0].replace(/^https?:\/\/[^/]+/, "");
    else await new Promise((r2) => setTimeout(r2, 300));
  }
  await page.goto(link.startsWith("/") ? WEB + link : link);
  await page.waitForSelector("text=Email confirmed");
  await page.locator(".card").getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await page.goto(`${WEB}/groups`);
  return { ctx, page, email, handle };
}

// ── Public landing (light + dark) ────────────────────────────────────────────
const anon = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
await anon.goto(`${WEB}/`);
await anon.waitForTimeout(900);
await shot(anon, "01-landing-light");
await anon.getByRole("button", { name: /dark mode/i }).click();
await anon.waitForTimeout(400);
await shot(anon, "02-landing-dark");
await anon.getByRole("button", { name: /light mode/i }).click();
await anon.close();

// ── Owner: dashboard, create a code, feed with status ───────────────────────
const owner = await newUser("owner");
const { page: o } = owner;
await o.goto(`${WEB}/dashboard`);
await o.waitForTimeout(900);
await shot(o, "03-dashboard-codes");
await o.goto(`${WEB}/dashboard/tokens/new`);
await o.getByLabel("Name", { exact: true }).fill("Hair braiding");
await o.getByRole("button", { name: "Create code" }).click();
await o.waitForSelector("text=Ready to share");
await shot(o, "04-new-code");

// Owner starts a group and posts with an attached code.
await o.goto(`${WEB}/groups`);
await o.getByTestId("group-name").fill("Manzini Market");
await o.getByTestId("group-create").click();
await o.waitForURL(/\/groups\/[0-9a-f-]{36}/);
await fillComposer(o, "Fresh vegetables every Saturday — come find us at the bus rank stall!");
await submitComposer(o, "Fresh vegetables");

// Owner posts a status with a code attached.
await o.goto(`${WEB}/groups`);
await fillComposer(o, "Open today until 5pm. Reach me safely with the code below.");
await o.getByTestId("attach-code").click();
await submitComposer(o, "Open today until 5pm");

// ── Member: joins, follows, multilayer comments ─────────────────────────────
const member = await newUser("member");
const { page: m } = member;
await m.goto(`${WEB}/people`);
await m.waitForTimeout(1000);
await shot(m, "05-people-discover");
// Follow the owner from People
const followBtn = m.locator('[data-testid="follow-person"]').first();
if (await followBtn.count()) { await followBtn.click(); await m.waitForTimeout(600); }

await m.goto(`${WEB}/groups`);
await m.getByTestId("group-search").fill("Manzini");
await m.getByRole("button", { name: "Search" }).click();
try {
  await m.waitForSelector('[data-testid="ask-join"]', { timeout: 8000 });
} catch {
  await shot(m, "debug-search");
  console.log("FOUND DEBUG:", await m.locator('[data-testid="found-group"]').allInnerTexts().catch(() => "?"));
  throw new Error("ask-join missing");
}
await m.getByTestId("ask-join").first().click();
await m.waitForTimeout(800);

// Owner lets them in.
await o.goto(`${WEB}/groups`);
await o.waitForSelector('[data-testid="requests-badge"]');
await o.getByRole("link", { name: "Manzini Market" }).click();
await o.getByTestId("approve-join").click();
await o.waitForTimeout(800);

// Member opens the group and writes a post + comments (multilayer!).
await m.goto(`${WEB}/groups`);
await m.getByRole("link", { name: "Manzini Market" }).click();
await m.waitForURL(/\/groups\/[0-9a-f-]{36}/);
await m.goto(m.url());   // HARD reload: isolate client-nav vs hydration behaviour
await fillComposer(m, "Do you deliver to Lobamba?");
await submitComposer(m, "Do you deliver to Lobamba");

// comments: root -> reply -> reply-to-reply (3 levels, properly scoped)
const firstPost = m.locator('[data-testid="post"]').first();
const cToggle = firstPost.locator(".linkbtn.small").first();
// Click until the thread actually opens (a click during a React re-render can land on a dead node).
let opened = false;
for (let i = 0; i < 4 && !opened; i++) {
  await cToggle.click({ timeout: 5000 }).catch(() => {});
  await m.waitForTimeout(700);
  opened = (await cToggle.getAttribute("aria-expanded").catch(() => "false")) === "true";
}
console.log("COMMENTS OPENED:", opened);
if (!opened) {
  console.log("POST SNAPSHOT:", await firstPost.ariaSnapshot());
  throw new Error("comment toggle would not open");
}
// root comment via the form at the bottom of the thread
const topInput = firstPost.locator(".comment-form input").first();
for (let i = 0; i < 6; i++) {
  await topInput.fill("Anyone know their prices?");
  await m.waitForTimeout(300);
  if ((await topInput.inputValue().catch(() => "")) === "Anyone know their prices?") break;
}
await firstPost.locator(".comment-form .btn").first().click();
await m.waitForTimeout(1000);
const rootComment = m.locator(".comment").first();
await rootComment.locator(".linkbtn.tiny").click();
await rootComment.locator(".comment-form input").fill("Yes — a tray of tomatoes is E45.");
await rootComment.locator(".comment-form .btn").click();
await m.waitForTimeout(1000);
// reply to the reply (level 3)
const nested = m.locator(".comment.replies .comment").first();
if (await nested.count()) {
  await nested.locator(".linkbtn.tiny").click();
  await nested.locator(".comment-form input").fill("Thanks! And spinach?");
  await nested.locator(".comment-form .btn").click();
  await m.waitForTimeout(1000);
}
console.log("NESTED COUNT:", await m.locator(".comment.replies .comment").count());
await m.evaluate(() => window.scrollTo(0, 0));
await m.waitForTimeout(500);
await shot(m, "06-group-threaded-comments");

await m.goto(`${WEB}/groups`);
await m.waitForTimeout(1400);
await shot(m, "07-feed");
// Following filter
await m.getByRole("button", { name: "Following" }).click();
await m.waitForTimeout(600);
await shot(m, "08-feed-following");

// Notifications panel + account menu
await m.getByRole("button", { name: /Notifications/ }).click();
await m.waitForTimeout(700);
await shot(m, "09-notifications");
await m.keyboard.press("Escape");
await m.getByTestId("account-menu").click();
await m.waitForTimeout(400);
await shot(m, "10-account-menu");
await m.keyboard.press("Escape");

// Owner view: feed with status strip, then chat
await o.goto(`${WEB}/groups`);
await o.waitForTimeout(1400);
await shot(o, "11-feed-owner");

// Gate page (visitor side): the member sees the owner's status code as a tappable card.
await m.goto(`${WEB}/groups`);
const gateHref = await m.locator('[data-testid="code-card"]').first().getAttribute("href");
console.log("GATE HREF:", gateHref);
const anon2 = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
await anon2.goto(`${WEB}${gateHref}`);
await anon2.waitForTimeout(900);
await shot(anon2, "12-gate-signed-out");
await anon2.close();

// Dark mode feed for the member
await m.getByRole("button", { name: /dark mode/i }).click();
await m.waitForTimeout(500);
await shot(m, "13-feed-dark");
await m.getByRole("button", { name: /light mode/i }).click();

// Mobile view of the feed
const mob = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36" })).newPage();
// reuse member cookies? simpler: sign in fresh on mobile
const mobEmail = `mob_${rnd}@example.test`;
await mob.goto(`${WEB}/login`);
await mob.getByLabel("Email").fill(member.email);
await mob.getByLabel("Password").fill("correct horse battery staple");
await mob.getByRole("button", { name: "Sign in", exact: true }).click();
await mob.waitForURL(`${WEB}/groups`);
await mob.waitForTimeout(1200);
await shot(mob, "14-feed-mobile");
await mob.getByRole("button", { name: /Open menu/i }).click();
await mob.waitForTimeout(400);
await shot(mob, "15-mobile-menu");

fs.writeFileSync(`${OUT}/handles.json`, JSON.stringify({ owner: owner.handle, member: member.handle }, null, 2));
console.log("DONE. Screenshots in", OUT);
await browser.close();
