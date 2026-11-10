# What PryingEyes looks like now — a tour

After you deploy this build, here is what you and your users will see, screen
by screen. Screenshots of every view below are in `download/screenshots/`
(captured from the real app in this state).

## First sight: the landing page (visitors)

`01-landing-light.png` · `02-landing-dark.png`

A quiet, centered hero: **"Share a code, not your phone number."** with the
second half of the headline set in the cyan→blue signal gradient. Under it,
three trust chips — *No numbers shared · Encrypted & logged · You approve who
reaches you* — then the sign-in / create-account card with its tabbed pill,
and a "Reach someone" panel where a visitor pastes a code or link they were
given. Dark mode turns the page into deep-space navy with aurora glows; the
theme never flashes thanks to the bootstrap script now allowed by the CSP.

## The top bar (signed in)

`09-notifications.png` · `10-account-menu.png`

Controls are grouped instead of scattered: a segmented pill on the left holds
**Feed · People · Chats · Codes** (the active one glows with the signal
gradient); the right side holds **Requests**, a **bell** with an unread badge
(opening it shows recent alerts and marks them read), the **theme toggle**,
and an **account chip** with your avatar initial and @handle (menu: Settings,
Audit trail, Moderation, Admin, Sign out). On phones this collapses into a
drawer that lists every destination (`15-mobile-menu.png`).

## The Feed (home for signed-in users)

`07-feed.png` · `08-feed-following.png` · `13-feed-dark.png` · `11-feed-owner.png`

- A **status strip** of 24-hour rings across the top — your ring first ("Add
  yours" until you post), then one ring per person with a live status. Tap a
  ring to see only that person; tap again to go back.
- The **composer** ("What's on your mind?") with its *Attach my contact code*
  pill and a gradient send button.
- The **timeline**: each post shows a gradient avatar, @handle, relative time,
  a Follow/Following button (flips instantly), delete (two-tap confirm) and
  report icons, the post text, any attached contact code as a gradient-marked
  card, and the comment thread underneath.
- *Latest / Following* segmented filter above the timeline.
- The right rail: a **People** card (suggested follows, one-tap follow) and
  the **Groups hub** (search groups, your groups with waiting-request badges,
  start a group, join by invite).

## People (new)

`05-people-discover.png`

A dedicated discovery page: search anyone by @handle, or browse suggestions of
people you actually cross paths with — shared groups, your followers, people
you follow — each with follower counts, "live now" hints and a one-tap
optimistic Follow. Privacy rule: suggestions only include people you share a
group with, people who follow you, or people you follow; a handle search can
find anyone whose handle you already know.

## My codes (the dashboard)

`03-dashboard-codes.png` · `04-new-code.png`

An eyebrow tag ("Contact codes"), the page title, and grouped actions: **New
code** (gradient button) and **Panic: revoke all** (disabled until you have an
active code). Four compact stat tiles, the codes table (prefix-only display —
full codes appear exactly once, at creation or rotation, in the share dialog
with copy link/short-code and QR), the live audit feed, and a collapsible
"How people reach you" explainer.

## Groups

`06-group-threaded-comments.png`

The group page keeps its admin tools in the right rail (join requests,
invite link, members) and now supports **threaded comments of any depth** on
every post: replies indent under their exact parent along a cyan guide line
and carry a "replying to @handle" label. Comments appear the instant you post
them.

## The gate (what code-openers see)

`12-gate-signed-out.png`

Opening a code (`/t/…`) shows the same calm design: who they're trying to
reach, the tier pill, a step progress list (signed in → human check → confirm
code → ask the owner), and clear action buttons. Everything fits a phone
screen with no horizontal scroll.

## Mobile

`14-feed-mobile.png` · `15-mobile-menu.png`

The feed stacks the composer, status strip and timeline with the People and
Groups cards below; the hamburger opens a drawer with every destination,
primary links first.

---

## Deploying it

Everything runs exactly as before — nothing about the runtime changed:

```bash
unzip pryingeyes.zip && cd pryingeyes
npm install
npm run build
PORT=3000 npm start          # behind nginx: docs/DEPLOY-SUBDOMAIN.md
```

(or `docker compose -f docker-compose.prod.yml up -d --build` — see
docs/DEPLOY-DOCKER.md). On first start the app creates `.env` from the new
`.env.example`, generates fresh keys, builds its built-in database and runs
migrations — including `0010_no_token_plaintext`, which drops the accidental
plaintext code columns. Backup rule unchanged: **back up `.env` and `var/data/`
together**.
