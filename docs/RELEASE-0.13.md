# PryingEyes 0.13 — content bot, Phase 4 (posting, pace and stats)

On top of Phase 3. No new migration — the posting flow reuses `content_items.post_id` and the existing `posts.expires_at`.

## What changed

| Area | Files | Change |
| --- | --- | --- |
| Setting | `src/lib/env.ts` | `CONTENT_BOT_DAILY_CAP` (default 10) — how many notice posts the bot may make in a day. |
| Posting | `src/lib/social.ts`, `src/lib/content.ts` | `createPost` now accepts an optional expiry; `postReadyItems()` posts `ready` items into their routed group as the bot, up to the daily cap, and marks them `posted`. |
| Post text | `src/lib/content.ts` | Summary (own words) + `Source: <url>` + `Apply by: <date>`. If a summary still contains contact details it is held as `needs_review` rather than posted. |
| Expiry | `src/lib/content.ts` | `expireBotPosts()` removes bot posts whose deadline has passed and marks their items `expired`. |
| Stats | `src/lib/content.ts`, `/api/admin/content/stats`, `/admin/content` | A Stats tab: today vs the daily cap, posts per day (14 days), posted-by-kind and the queue by status. |
| Admin entry | `src/app/admin/page.tsx` | The break-glass admin page now links to the content bot. |
| Prompt | `src/lib/content-ai.ts` | The summariser is told never to include phone numbers or email addresses. |
| Tests | `tests/unit/content-post.test.ts` (new), content-ai prompt assertion | Post-text shape and the contact-details instruction. |

## The flow now, end to end

fetch → queue (`new`) → AI summarise → `ready` (confident) or `needs_review` → post into the routed group (paced by the daily cap) → expire at the deadline.

## Remaining (Phase 5)

The Eswatini starter sources — a researched list loaded disabled, so the bot has real places to watch as soon as you turn it on.
