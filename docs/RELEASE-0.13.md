# PryingEyes 0.13 — content bot, Phase 2 (sources and queue, no AI)

On top of the Phase 1 commit. Migration `0022_content_bot` runs automatically on start.

## What changed

| Area | Files | Change |
| --- | --- | --- |
| Bot setting | `src/lib/env.ts` | `CONTENT_BOT=on/off` (default off). |
| Tables | `drizzle/0022_content_bot.sql`, `src/db/schema.ts` | `content_sources`, `content_items` (the queue), `content_routes`, `content_state` (singleton). |
| Bot logic | `src/lib/content.ts` (new) | Sources/routes/queue CRUD, the run loop, and rules-only extraction. |
| Fetcher | `src/lib/safe-fetch.ts` | `safeFetchHtml` now takes an `accept` content-type regex so the bot can read RSS/Atom too. The existing SSRF guard (blocked addresses, redirect re-checks, size cap, timeout) is reused unchanged. |
| Timer | `src/server-boot.ts` | When `CONTENT_BOT=on`, a built-in timer ticks every 15 minutes; it does nothing until an admin resumes it. |
| Admin | `/api/admin/content/{sources,routes,items,state}`, `/admin/content` | Admin-only Queue, Sources and Routes screens plus pause/resume. |
| Public | `/bot` | A public page explaining the bot; no source or queue details. |
| Tests | `tests/unit/content-extract.test.ts`, `tests/unit/safe-fetch.test.ts` | Rules-only extraction and the SSRF guard. |

## Rules-only mode

A source is `rules` by default and needs no AI. The fetcher reads the page and:

- RSS/Atom → one item per `<item>`/`<entry>`.
- HTML → the page is one notice, or split by an optional `{"itemRegex": "…"}` rule in the source's Rules JSON.
- A deadline is found from phrases like "Deadline:", "Apply by", "Closing date" next to a date.

Every item is deduplicated by URL and lands in the queue as `new` for review. Posting and AI summarising come in Phase 3.

## Not done yet (later phases)

- AI extraction, confidence, trust ramp, and the prompt-injection test.
- Posting into groups (the routes table is ready but unused), deadlines expiring posts.
- Daily caps, digests and the Stats tab.
- The Eswatini starter sources (researched list, loaded disabled).
