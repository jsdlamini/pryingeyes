# PryingEyes 0.12 — instructions for a coding agent

You are updating the PryingEyes web app (Next.js 15, React 19, Drizzle, PGlite/PostgreSQL, Redis) to
version 0.12. Part of the work is already done on the `redesign-0.12` branch (or in
`pryingeyes-0.12.patch`). Your job: apply it, verify it, then do the remaining tasks in Part C in order.

Ground rules:

- Never send anything to a user's phone number. One-time codes and notices go by **email**, in-app
  notifications, web push, passkey or authenticator — not SMS. There is no SMS path in the code; keep it that way.
- Codes are stored as HMACs only. No screen may claim to show an existing code again; "share" always
  mints a new code (see `mintShareCode`, `TokenShare`).
- Every change ships with a test in `tests/integration` (or `tests/unit`). Run the suite before and after.
- Keep the house style: route handlers wrapped in `route()`, input parsed with zod via `readJson`,
  errors via `lib/errors`, user-facing copy in plain words (no "tier", "token", "relay", "grant").
- Do not commit `.bak` files. Do not push to `main`; open a pull request from your branch.

## Part A — apply and check the work already done

```bash
git checkout -b redesign-0.12            # or: git checkout redesign-0.12 if the branch exists
git am pryingeyes-0.12.patch             # skip if the branch already has the commit
npm ci
npm run typecheck
TEST_DATABASE_URL=embedded TEST_REDIS_URL=memory npx vitest run
npx next build
```

Expected: typecheck and build clean; **180 passed, 3 failed**. The 3 failures are pre-existing on `main`
(see C1), not caused by this patch. `tests/integration/uploads.test.ts` (7 tests) must pass.

Migration `drizzle/0018_uploads.sql` adds the `uploads` table. It runs automatically on start
(`scripts/prepare.mjs`) or with `npm run db:migrate`.

### What the patch changes

| Area | Files | Change |
| --- | --- | --- |
| Private uploads | `src/lib/uploads.ts`, `src/app/uploads/[file]/route.ts` | Files served only to signed-in people who can see something that uses them (`canView`); `Cache-Control: private, no-store`; same 404 for "missing" and "not yours". |
| Upload ownership | `src/lib/uploads.ts` (`ownUpload`), `chat.ts`, `social.ts`, `api/me/settings` | An attachment or avatar must be a file the same user uploaded. |
| Metadata stripping | `src/lib/uploads.ts` (`storeUpload`) | Type checked by magic bytes; JPEG/PNG/WebP re-encoded with `@napi-rs/canvas` (drops EXIF/GPS; the decoder applies orientation); MP4/MOV `udta`/`meta` boxes renamed to `free`; photos capped at 2048 px; 100 uploads/user/day. |
| Deletion | `chat.ts`, `social.ts`, `dsr.ts`, `retention.ts` | File deleted when a view-once photo is opened, when messages/statuses expire, when a post is deleted, when an account is erased; `sweepUploads()` removes unreferenced files older than a day. |
| Storage path | `src/lib/env.ts`, `.env.example`, `docker-compose.yml`, `Dockerfile` | New `UPLOAD_DIR` (default: `uploads` next to `DATA_DIR`, i.e. `/app/var/uploads` as before). Dev compose mounts an `uploads` volume on app and jobs. |
| Link preview SSRF | `src/lib/safe-fetch.ts`, `api/link-preview` | Address checked at connect time (blocks loopback, private, link-local, CGNAT, mapped IPv6, metadata); manual redirects (max 3) re-checked; 256 KB cap; ports 80/443/8080/8443 only; 60 previews/user/hour. |
| Reactions | `src/lib/reactions.ts` | Must be able to see the post/comment/message; emoji must be in `EMOJIS`; rate-limited. |
| Navigation | `BottomNav.tsx`, `NavLinks.tsx`, `api/notifications` | Codes · Requests (badge) · Chats · Community · Me. Signed-in home is `/dashboard`. `requestsWaiting` added to `GET /api/notifications`. |
| Plain level names | `Tier.tsx` (+ users) | Open · Checked · Ask me · Vault, one shared `TIER_LINES` description set. |
| Show-once code | `TokenShare.tsx`, `tokens/new`, `DashboardClient.tsx` | Code shown as a "pass" with QR; Web Share button; Done disabled until copied/shared/saved; closing unsaved asks first. |
| Caller gate | `Gate.tsx`, `t/[code]`, `r/[id]`, `gate.ts` | Shows the masked email the code goes to, says nothing goes to their phone, "you can close this page"; acceptance notice is now also emailed. |
| Chat polling | `chats/[id]/page.tsx` | Polls only messages after the last one (`?after=`), full refresh every 30 s, nothing while the tab is hidden. |
| Look | `globals.css` | Pop colours (coral, amber, lime, violet), code-pass styles, nav badge and current-tab bar, `prefers-reduced-motion`. |
| Hygiene | 13 `*.bak*` files | Removed from git. |

## Part B — manual checks after deploying to staging

1. Upload a phone photo with location on. Download it from the chat; run `exiftool` on it — no GPS, no camera fields.
2. Copy a chat photo URL into a private window → 404. Signed in as a third account → 404.
3. Open a view-once photo as the recipient → `ls var/uploads` no longer has the file.
4. Paste `http://169.254.169.254/` and `http://localhost:3000` into a post → no preview.
5. On a phone-width screen: bottom nav shows Codes, Requests (badge when someone waits), Chats, Community, Me.
6. Create a code → Done stays disabled until you copy, share or save the QR.
7. **Mobile app:** `/uploads/*` now needs auth. The phone app (not in this repo) must send its bearer
   token when loading images and audio (e.g. React Native `<Image source={{ uri, headers: { Authorization: `Bearer ${token}`, "X-PE-Client": "mobile", "X-PE-Device": device } }} />`). Until it does, media won't load in the app.

## Part C — remaining tasks, in order

C1. **Stale tests.** `calls.test.ts` and `contact.test.ts` expect the owner can't start a call from a chat,
but 0.11 allows it (`callOptionFor` returns `canStart: true, chatCall: true`). Decide with the product
owner which is intended; then fix either the code or the three tests. Don't skip them.

C2. **Richer request cards** (`/dashboard/requests`, `GET /api/requests`). Add per request: caller email
verified (bool), passkey or authenticator set up (bool), account age in days, country (already `region`),
which code (label) and the note. Render as chips (green = good, amber = new account). Add Undo for 5 s
after a decision (delay the `decide` call client-side, or add an `undo` endpoint valid for 5 s).

C3. **Codes as cards on phones.** In `DashboardClient`, below 600 px render each code as a `.code-pass`-style
card (label, level chip, `displayPrefix` + `-•••••`, uses, status) with Pause / Replace / Activity buttons,
instead of the table that hides the Code column. "Replace" = rotate: revoke and mint a new code with the
same label, level and limits, then open `TokenShare` — the API already exists: `POST /api/tokens/[id]`
`{action:"rotate"}` (`rotateToken` in `lib/tokens.ts`).

C4. **Move "Revoke every code".** From the dashboard header to Me → Safety, with press-and-hold (1.5 s)
to confirm. Keep `data-testid="panic-confirm"` working or update `tests/e2e`.

C5. **Faster caller checks, still no SMS.** In the gate, offer passkey and authenticator as alternatives to
the emailed code when the caller has them (`lib/webauthn.ts`, TOTP routes). Server: accept a fresh step-up
(`requireStepUp` within 10 min) as passing the `otp` step for tier 2/3. Add tests.

C6. **One event stream instead of five pollers.** Add `GET /api/events` (Server-Sent Events) per session,
fed by Redis pub/sub: new message, request waiting/decided, incoming call, notification. Replace the
intervals in `IncomingCall` (3 s), `chats/[id]` (3 s), `Gate` (5 s), `NavLinks`/`BottomNav` (20–30 s).
Keep polling as a fallback when the stream drops.

C7. **Data-light mode.** User setting `dataLight` (default on when `navigator.connection.saveData`): don't
auto-load images, voice notes or link previews; show "Tap to load". Migration + settings toggle + chat/feed.

C8. **Local languages.** Add siSwati and isiZulu number words to `WORD_DIGITS` in `lib/guard.ts`
(with unit tests in `tests/unit/guard.test.ts`), and siSwati strings for the gate screens in `src/i18n`.

C9. **Installable app + web push.** Manifest, service worker, VAPID keys in env, push for requests,
accepted requests, messages and incoming calls. Respect Do Not Disturb.

C10. **Smaller items.**
- `shareCodeByDefault` defaults to `true` (commit `ca3d490`). Recommend `false` for a privacy-first app;
  confirm with the product owner before changing the migration default.
- Session binding to the exact user-agent signs people out after browser updates; bind to a device cookie
  or compare browser family + major version only (`lib/session.ts`).
- `GET /api/numbers`: replace the per-number count loop with one grouped query.
- Media seeking: support `Range` requests in `uploads/[file]`.
- Update `docs/SECURITY_REVIEW.md` and `docs/THREAT_MODEL.md` for uploads, link preview, calls, reactions, stories.

When you finish each task: run typecheck, the full suite and `next build`, then write one line per task
in `docs/RELEASE-0.12.md` (what changed, which test covers it).
