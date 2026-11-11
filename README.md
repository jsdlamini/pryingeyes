# PryingEyes — Phase 1 (MVP website)

Share a code, not your phone number. Owners publish an opaque link, QR code or short code. Anyone who wants to reach them passes a verified, rate-limited, fully logged **decode gate**. Depending on the tier the owner chose, the gate shows a watermarked image of the number or asks the owner for consent. People then **call each other in the app over data** (WebRTC through our own TURN relay) or **chat**, without either number ever being used. Phone numbers are never needed: codes work on their own, and a number is an optional extra that approved people may see once.

**Safe groups and statuses.** People don't have to post their number in a group or on their status to be reachable. Phone numbers, email addresses and messaging links are refused there, even disguised (spaced digits, "seven six one…", "name at gmail dot com"). Instead the author attaches a **contact code**: others tap it, and PryingEyes opens straight on the gate with the code already filled in. That happens in the phone app if it's installed, otherwise on the website. Anyone can start a group and anyone can find one and ask to join, but only the group's creator or the admins they appoint let people in. Members see each other by handle only, and statuses last 24 hours. Codes can be shared in groups, statuses and private chats: standing ones, 24-hour ones, or one-person codes that stop after a single use.

**The "Sonar" redesign (v0.11).** The site now opens on a **feed** with 24-hour status rings, a **People** page for finding and following the users you cross paths with, threaded comments of any depth, a notifications bell, and a grouped top bar (Feed · People · Chats · Codes). The pink palette is replaced by a deep-navy + signal-cyan identity in light and dark mode, with compact spacing, icon-led actions and WCAG-AA contrast. See [`docs/RELEASE-0.11.0.md`](docs/RELEASE-0.11.0.md) for everything that changed (including real security and privacy fixes) and [`docs/DESIGN-TOUR.md`](docs/DESIGN-TOUR.md) for a screen-by-screen tour.

Built from *PryingEyes — Development Agent Prompt v1.1*. Everything in Phase 1 is implemented and tested. See [`docs/FINAL_REPORT.md`](docs/FINAL_REPORT.md) for the milestone report and test results.

---

## Run it (two commands)

You need **Node.js 22** (`node -v`). Nothing else: no Docker, PostgreSQL or Redis.

```bash
unzip pryingeyes.zip && cd pryingeyes
npm install
npm run dev                  # http://localhost:3000
```

The first `npm run dev` sets everything up by itself:
- **Settings:** it creates `.env` for this computer, with fresh secret keys.
- **Database:** it starts a PostgreSQL database built into the website, kept in `var/data/`, and brings it up to date.
- **Background jobs:** it runs the housekeeping jobs inside the website, so there's no separate worker. These expire codes, delete disappearing messages and notice missed calls.

**Back up `.env` and `var/data/` together.** The keys in `.env` unlock the data, and a new `.env` can't read old data. The app refuses to start rather than invent new keys over existing data.

For production, build once and start:

```bash
npm ci && npm run build
PORT=3000 npm start          # behind nginx: see docs/DEPLOY-SUBDOMAIN.md
```

**Your own settings** go in the **YOUR SETTINGS** block at the top of `.env`:
- the site address (`APP_URL`);
- `ADMIN_EMAILS`, which makes your account an admin as soon as you confirm its email;
- the Resend key for email;
- Cloudflare Turnstile keys for the human check.

Each service has a development stand-in until you add its key. With `APP_ENV=production`, the website won't start until the real ones are set, and it tells you exactly what's missing.

**Optional outside services** (set them in `.env`):

| Setting | Empty (default) | Set |
|---|---|---|
| `DATABASE_URL` | Built-in PostgreSQL (PGlite) in `DATA_DIR`. Only the website may open it; scripts such as `npm run seed` need the website stopped. | Your PostgreSQL server. Needed to run several copies of the app, or scripts alongside it. |
| `REDIS_URL` | Built-in memory store. Rate limits and call signalling reset when the website restarts. | Your Redis server. Needed for several copies of the app. |

**In-app calls** need the TURN relay (coturn), because a relay can't run inside Node. Chats, groups and codes all work without it. On Ubuntu, `sudo apt install coturn`; the settings are in `docs/DEPLOY-SUBDOMAIN.md` §2. For local development, `docker compose up -d coturn` also works.

**Production with Docker:** `docker compose -f docker-compose.prod.yml up -d --build` runs the website (built-in database in a volume) and the call relay. See `docs/DEPLOY-DOCKER.md`.

**`./start.sh` is optional.** It still does the whole Docker-based setup: PostgreSQL, Redis and coturn in containers, and the phone app modes (`app-web`, `android`, `device`). Plain `npm run dev` doesn't need it.

Open **http://localhost:3000**. While developing, nothing is really sent:

| What | Where to see it |
|---|---|
| Emails (confirmation links, codes, alerts) | **http://localhost:3000/dev/outbox** |
| Real emails through Resend (optional locally) | Set `EMAIL_PROVIDER=resend` and `RESEND_API_KEY`, then `npm run email:test -- --to=you@example.com` |
| Seeded accounts and token links | Terminal output of `npm run seed`, also saved to `var/seed-credentials.txt` |
| Current authenticator code for a seeded key | `npm run dev:totp -- <key>` |
| In-app calls | Real calls between two browsers. Use two browser profiles (or a normal and a private window) signed in as the owner and the caller; allow the microphone. Audio goes through the local coturn relay. |

The website runs the retention jobs itself (`BACKGROUND_JOBS=on`). They expire tokens and consent requests, delete disappearing messages, apply audit retention and write the daily audit anchor. To run them as a separate process instead, set `BACKGROUND_JOBS=off` and run `npm run jobs`; that needs an external `DATABASE_URL`.

### Try the main flows

1. **Owner:** sign up with an email (confirm it with the link from `/dev/outbox`), then create a code under **My codes**. No number or two-step sign-in is needed. Adding a number to show is optional (Settings → *Show my number*), and needs two-step sign-in first.
2. **Caller:** open the code link in a private window and choose *Create an account*. Sign up with any email, confirm it from `/dev/outbox` and sign in: you land back on the code. A handle is suggested for you (keep it, tap *Suggest another*, or type your own). Pass the human check.
   - **Tier 1:** chat or call in the app straight away. If the owner added a number to the code, you can also see it once as a watermarked image that hides itself after 60 seconds.
   - **Tier 2:** confirm a 6-digit code emailed to you first.
   - **Tier 3:** send a note and wait. The owner approves under **Requests**, then you can chat or call in the app.
   - **Your own code, one tap:** after your first message or call, PryingEyes offers to make a code for you — *Make my code* creates one in a single step and opens the share card, or *Not now* hides the offer for good.
   - **Chat and call privately:** on the gate, pick *Chat in the app* (the owner gets a notification and an unread badge on **Chats**) or *Call in the app*. From an open chat, the caller can also start a call.
   - The optional *Show my number* field has a country picker. Choose the country and type the number without the dialling code, or paste a full `+...` number and the country switches automatically.
   - **Call in the app:** with the owner's PryingEyes open in another window, choose *Call in the app* on the gate (or in the chat). The owner sees a ringing banner on any page and answers. If the owner's app is closed, the call becomes a **missed call** they see in notifications and in the chat. To test from your phone on the same Wi‑Fi, open `http://<your-computer-ip>:3000` and set `TURN_URLS=turn:<your-computer-ip>:3478?transport=udp` in `.env`. Browsers only allow the microphone on `localhost` or HTTPS, so on a phone use an HTTPS tunnel or the production setup.
3. **Panic:** on the dashboard, *Panic: revoke all* kills every code at once.
4. **Moderation and admin:** put your email in `ADMIN_EMAILS` and your account becomes an admin once its email is confirmed. Or, with the website stopped (or an external database), run `npm run admin:create -- --handle=<you> --role=admin`. The seed also creates a moderator and two admins.

---

## Phone app (iOS and Android)

`mobile/` holds the Expo app: everything the website does, including in-app calls, on phones and emulators. Setup for the Android emulator, the iPhone simulator, real phones and Expo Go is in [`mobile/README.md`](mobile/README.md). In short:

```bash
# server .env: let phones reach the call relay at your computer's LAN address
TURN_URLS=turn:192.168.1.20:3478?transport=udp,turn:192.168.1.20:3478?transport=tcp
cd mobile && npm ci && npx expo run:android   # or: npx expo run:ios on a Mac
```

## Tests and checks

```bash
npm test                     # 106 unit + integration tests (uses the pryingeyes_test database)
npx playwright install chromium
npm run build && npm start   # in one terminal
npm run test:e2e             # browser journeys, incl. real passkeys via a virtual authenticator
npm run verify:all           # everything below, in order, with a pass/fail summary
```

| Check | Command | Pass condition |
|---|---|---|
| Enumeration campaign | `npm run attack:enumerate` | > 99.9% of 10,000 guesses blocked, 0 succeed |
| Plaintext numbers | `npm run scan:plaintext` | 0 numbers in any table, log or `--path=` file |
| Audit chain | `npm run audit:verify` | Every link and anchor verifies |
| Load | `npm run load:test` (server with raised budgets; see the script header) | Decode-gate p95 < 300 ms |

---

## Project layout

```
src/lib/           security core — vault, tokens, gate, reveal, calls, chat, audit, evidence, dsr, retention
src/app/api/       route handlers (thin; all logic is in src/lib)
src/app/…          pages: owner dashboard, caller gate (/t/<code>), groups (/groups, invites at /g/<invite>), chats, settings, moderation, admin
src/lib/guard.ts   contact-details guard for groups and statuses; src/lib/social.ts groups, posts, statuses
src/db/schema.ts   database schema (Drizzle ORM); migrations in drizzle/
scripts/           migrate, keys, seed, jobs, attack, scan, verify, load test
tests/             unit, integration (real Postgres + Redis) and e2e (Playwright)
docs/              threat model, assumptions, deployment, launch checklist, security review, final report
```

## Switching to real providers

Set these in `.env` and change `APP_ENV` to `staging` or `production`. The app refuses to start in those modes while any development stand-in is still configured.

- **Human check:** `CAPTCHA_PROVIDER=turnstile`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`.
- **Email (Resend):** `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` (from resend.com/api-keys), and `EMAIL_FROM` on a domain you've verified in Resend, e.g. `PryingEyes <no-reply@yourdomain.com>`. Optional `EMAIL_REPLY_TO`. Check it with `npm run email:test -- --to=you@example.com`.

See [`docs/DEPLOY.md`](docs/DEPLOY.md) before putting this on a server.
