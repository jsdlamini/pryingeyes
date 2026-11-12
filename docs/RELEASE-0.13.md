# PryingEyes 0.13 — content bot, Phase 1 (places + official groups)

One phase on top of `f3baeda`. Migration `0021_places` runs automatically on start.

## What changed

| Area | Files | Change |
| --- | --- | --- |
| Places | `src/lib/places.ts` (new) | `placesFromRequest()` reads only `cf-ipcountry` + `cf-region-code`/`cf-region`, falls back to `DEFAULT_COUNTRY`, ignores `XX`/`T1`, and maps Eswatini's four regions. |
| Accounts | `users` (migration), signup, `/api/me`, `/api/me/settings` | `home_country`, `home_region`, `places_source` (detected/chosen), `extra_countries`, `seen_country`, `seen_since`. Sign-up sets them from headers with no new step. |
| Official groups | `groups` (migration), `src/lib/social.ts` | `country`, `region`, `topic`, `official`. Official notice boards join open with no approval, and are read-only for ordinary members (the bot, content moderators and admins post). |
| Bot account | `src/lib/bot.ts` (new) | `botAccountId()` creates/finds the `pryingeyes_bot` account (content_moderator role) on first use. |
| Settings | `settings/page.tsx`, `mobile/src/app/(tabs)/account.tsx` | A Places section on website and app: country and region, detected-vs-chosen, and "Use detected location". |
| Labels | `Social.tsx`, `globals.css` | A Bot tag on the bot account's posts. |
| Tests | `tests/unit/places.test.ts` (new) | No header, XX, T1, known region code, plain region name, unknown region code, another country. |

## Owner update steps

Cloudflare country detection is on by default. For region detection, enable **Rules → Transform Rules → Managed Transforms → Add visitor location headers**.

## Not done yet (later phases)

- "Find a group" ordering and the quiet travel-suggestion line.
- The 14-day silent home-country refresh.
- Sources, the queue, the timer, AI extraction, the pace and stats, and the admin `/admin/content` area.
