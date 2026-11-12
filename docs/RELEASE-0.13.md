# PryingEyes 0.13 — content bot

Migration `0023_ai_extraction` runs automatically on start. (Phase 4 and 5 need no new migration.)

## Phase 3 — AI extraction

- `AI_PROVIDER=off/openai-compatible`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` (validated together).
- `content_items.summary` + `confidence`; `content_sources.trust`.
- `src/lib/content-ai.ts`: fixed zod form, `parseAiResponse`, `summarizeNotice`, `SYSTEM_PROMPT`, `CONFIDENCE_THRESHOLD` (0.7).
- The run loop summarises `new` items; confident ones become `ready`, the rest `needs_review`. Each result nudges source trust.
- Anti-injection: the prompt treats the notice as data and never follows it; the zod schema bounds the reply, so hijacked output is discarded.

## Phase 4 — posting, pace and stats

- `CONTENT_BOT_DAILY_CAP` (default 10) paces posting.
- `createPost` accepts an expiry; `postReadyItems()` posts `ready` items into their routed group as the bot, auto-joining, and marks them `posted`. Post text = summary + `Source: <url>` + `Apply by: <date>`.
- A summary that still contains contact details is held as `needs_review`.
- `expireBotPosts()` removes posts whose deadline has passed.
- A Stats tab (today vs cap, posts per day, posted-by-kind, queue by status) under `/admin/content`; the break-glass `/admin` page links to the bot.

## Phase 5 — Eswatini starter sources

Eight official Eswatini public-notice pages are seeded automatically on first boot (when the source list is empty), all **disabled**. The admin reviews and enables the ones that are live; the SSRF-guarded fetcher fails safely on any that are not. URLs are best-known candidates and should be verified before enabling.

Also in this pass: **Run now** forces a run even while the bot is paused, and reports `fetched / new / extracted / posted / expired`, so it is never silent.

## To run it

`CONTENT_BOT=on` + the AI variables in `.env`, restart, then in `/admin/content`: Resume (or Run now), enable sources, set routes, and watch the Queue.
