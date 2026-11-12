# PryingEyes 0.13 — content bot, Phase 3 (AI extraction)

On top of Phase 2. Migration `0023_ai_extraction` runs automatically on start.

## What changed

| Area | Files | Change |
| --- | --- | --- |
| Settings | `src/lib/env.ts` | `AI_PROVIDER=off/openai-compatible`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`. Required together when `openai-compatible`. |
| Tables | `drizzle/0023_ai_extraction.sql`, `src/db/schema.ts` | `content_items.summary` + `confidence`; `content_sources.trust`. |
| AI module | `src/lib/content-ai.ts` (new) | Fixed JSON form (zod `AI_EXTRACTION_SCHEMA`), `parseAiResponse`, `summarizeNotice`, `SYSTEM_PROMPT`, `CONFIDENCE_THRESHOLD`. |
| Run loop | `src/lib/content.ts` | After fetching, `extractDueItems()` runs the AI over `new` items; confident ones become `ready`, the rest `needs_review`. Each result nudges the source's trust up or down. |
| Admin | `/api/admin/content/run`, `/admin/content` | A Run-now button, AI summary + confidence + trust in the tables, and Approve/Discard for review. |
| Tests | `tests/unit/content-ai.test.ts` (new) | Prompt-injection resistance, schema rejection of hijacked/malformed output, markdown-fence parsing, the prompt's own safeguards. |

## How the trust ramp works

- A source starts at trust 0.
- Each extraction nudges it: +0.1 at confidence ≥ 0.8, −0.1 below 0.5, unchanged otherwise (0..1).
- Items at or above 0.7 confidence are marked `ready`; the rest wait for an admin's approve/discard.
- Trust is surfaced in the Sources tab and will gate automatic posting in Phase 4.

## The fixed form

The AI must return exactly:
`{"title","summary","category","country","region","deadline","confidence"}` — with `category` from the six kinds, `country` an ISO alpha-2 code, `deadline` ISO-8601 or null, `confidence` 0..1. Anything else is rejected by zod and the item stays untouched.

## Anti-injection stance

The prompt tells the model to treat the notice text as data and never follow instructions inside it. The zod schema bounds the reply to the fixed form, so a hijacked reply (plain text, extra keys, wrong types, made-up categories) is discarded rather than acted on. The unit tests exercise these paths.

## Owner update step

To enable AI extraction, set `AI_PROVIDER=openai-compatible`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` in the VPS `.env` and restart. It works with OpenAI, Groq, OpenRouter and local OpenAI-compatible servers.
