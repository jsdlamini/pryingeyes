# Release 0.11.0 — "Sonar" redesign, feed, people discovery, and deep fixes

This release is a full product polish pass over Phase 1: a new visual identity,
a real social feed with people discovery, and a series of correctness, privacy
and performance fixes — several of them latent bugs that had been quietly
degrading every page.

---

## 1. The new look: "Sonar"

The pink "Talk Sense" palette is gone. PryingEyes now wears a deep-water navy
identity with a signal-cyan accent — calm, trustworthy and high-contrast, in
both light and dark mode:

- **Palette**: deep navy ink on porcelain (light) / abyss navy with aurora
  glows (dark); cyan→blue gradient ("signal") for primary actions, avatars,
  status rings and the logo mark.
- **Typography**: Space Grotesk for display (headings, numbers, handles),
  Inter for text. Merriweather is no longer shipped.
- **Compact spacing**: card padding 22→16px, gutters 14→10-12px, radius
  22→16px, nav height and button sizes tightened. The interface is denser and
  faster to scan without feeling cramped.
- **Buttons are icon-led**: round icon buttons for destructive/report actions,
  icon+label pills for navigation, gradient send buttons, inline two-step
  delete confirmations instead of browser `confirm()` dialogs.
- **Micro-interactions**: 130ms colour/shadow transitions, press-scale on
  buttons, hover lifts — all disabled under `prefers-reduced-motion`.

## 2. Grouped controls at the top

The top bar is now organised in clusters instead of a flat list:

- **Social cluster** (segmented pill): Feed · People · Chats · Codes
- **Right cluster**: Requests · notifications bell (with a dropdown of recent
  alerts, auto-marked read when opened) · theme toggle · account chip
  (@handle avatar → Settings, Audit trail, Moderation, Admin, Sign out)
- On phones the drawer contains **every** destination (primary links first,
  secondary cluster below a divider).

## 3. Feed, statuses and People discovery

- `/groups` is now **the feed**: a 24-hour status ring strip (stories) on top,
  the composer, then the timeline. Tap a ring to filter to that person;
  *Latest / Following* segmented filter; per-post Follow buttons.
- **`/people` (new)**: search anyone by handle, plus suggestions of people you
  cross paths with — shared groups, your followers, people you follow — each
  with follower counts and live-status hints and one-tap optimistic Follow.
  The feed sidebar carries a compact People card with quick-follow.
- Group tools that were scattered across three cards are now one **Groups
  hub**: search, your groups (with waiting-request badges), start-a-group and
  join-by-invite (collapsible, auto-open for first-time users).

## 4. Multilayer comments — verified

- Comments now thread to **any depth**: replies nest under their exact parent
  with indented guide lines and a "replying to @handle" label. (Previously a
  reply-to-reply was orphaned and invisible.)
- Comments post **optimistically** (instant append, rollback on failure) and
  work on group posts too, not just statuses.
- Covered by e2e flows and a visual walkthrough screenshot
  (`download/screenshots/06-group-threaded-comments.png`).

## 5. Fixes: correctness, privacy, security

| # | Fix | Impact |
|---|-----|--------|
| 1 | **Hydration crash on every page** — `passkeysSupported()` rendered `false` on the server and `true` in the browser, so React discarded and rebuilt the whole tree on each load (React #418, flicker, dead clicks, lost input focus). Passkey UI is now decided after mount. | The single biggest source of the "clunky" feel. |
| 2 | **CSP blocked the theme bootstrap script** — the strict CSP had no hash exception for the inline script, so dark-theme users got a flash of light and further hydration noise. The script's SHA-256 is now whitelisted in `middleware.ts` and locked by a unit test. | Theme applies instantly; console clean. |
| 3 | **Contact codes stored in plaintext** — migration 0007 had added `link_code`/`short_code` columns next to the keyed hashes, defeating the hash-only design (a DB leak would expose every live code) and breaking "rotate to reveal". Migration 0010 drops the columns; codes are shown exactly once, at creation/rotation, and never again — not even to admins. | Caught by the pre-existing (failing) gate test; now green. |
| 4 | **Statuses were world-readable** — any signed-in user could read every status, contradicting the spec ("people who share a group"). Statuses are now visible only to your circle + people who follow you. | Caught by the pre-existing (failing) social test; now green. |
| 5 | **Signup handle race** — the email/password fields used stale-closure `setForm({...form})` updates that could wipe the auto-suggested handle when typed quickly. All updates are functional now, and `HandleField` self-heals if its value is wiped. | Signup no longer intermittently loses the handle. |
| 6 | **Missing `.env.example`** — a fresh clone could not build (`npm run build` / `npm run dev` failed at the prepare script). A documented template now ships with the repo; `KEK_PREVIOUS=` (blank) no longer crashes the key provider at first encryption. | First-run onboarding works. |
| 7 | **Rate limits**: comment creation had none (spam vector) — 60/hour per user added; follow spam limited to 100/hour; handle-suggestion checks raised from 60/min to 240/5min so NAT-shared connections (offices, campuses, carriers) aren't locked out mid-signup. | Anti-abuse brakes without punishing shared IPs. |
| 8 | **Repo hygiene**: 30+ `.bak*` files removed; e2e tests that referenced UI that no longer existed (status strip, "Sign out" location, `/dashboard` post-login landing) updated to the current design. | `npm test` and the e2e suites are green end-to-end. |

## 6. Accessibility (WCAG 2.1 AA, axe-verified)

- All text meets contrast thresholds in both themes (the timestamp and
  dark-mode input colours were raised after an axe audit flagged them).
- Icon-only buttons carry `aria-label`s; dropdowns expose `aria-expanded` and
  close on Escape/outside click; focus rings are visible everywhere.
- The e2e suite runs axe on the key pages and the feed — zero serious or
  critical violations.

## 7. Performance / perceived speed

- Polling (notifications, feed, dashboard) pauses while the tab is hidden and
  refreshes on re-focus.
- Follows and comments apply optimistically; the feed reloads in the
  background rather than blocking the tap.
- One GPU-composited background layer instead of `background-attachment:
  fixed` (a mobile scroll-jank source); Merriweather dropped from the bundle.
- No hydration rebuilds (see fix #1) — pages are interactive the moment they
  paint.

## Verification

- `npm run typecheck` — clean.
- `npm run test` — **176/176** (was 173/175 with 2 pre-existing failures).
- `npm run test:e2e` — **14/14** desktop journeys incl. axe audits.
- Screenshot walkthrough (`scripts/` in the delivery package) — 15 screens,
  light + dark + mobile, visually reviewed.
