# PryingEyes 0.12.2 — release notes (growth loop, Feature 1)

One feature on top of `372bad0`. Typecheck and lint clean; 180 of 183 existing tests pass
(the 3 failures already fail on `main`); 4 new server tests pass. Migration `drizzle/0019_loop_prompt.sql`
adds `users.loop_prompt` and runs automatically on start.

## What changed

| Area | Files | Change |
| --- | --- | --- |
| Growth prompt | `src/lib/growth.ts` (new), `src/lib/chat.ts`, `src/lib/calls.ts` | After a user's first successful contact (a message sent or a call answered), offer the loop once — but never to someone who already owns a code. One indexed query, fire-and-forget, never blocks the message or call. |
| Prompt state | `users.loop_prompt`, `api/me`, `api/growth/dismiss` | `null` = never shown, `"shown"`, `"dismissed"`. Stored on the account, not in the browser. |
| Audit | `src/lib/audit.ts` | `growth.loop_prompt_shown`, `growth.loop_code_created`, `growth.loop_dismissed`; no identifiers beyond the existing audit fields. |
| Prompt card | `src/components/GrowthLoopPrompt.tsx` (new), `chats/[id]/page.tsx` | *"You just reached someone without seeing their number. Want a code like this for yourself?"* — **Make my code** / **Not now**, shown in the conversation. |
| Quick create | `dashboard/tokens/new/page.tsx`, `api/tokens` | `?quick=1` mode: name pre-filled "Contact me", the existing `/api/tokens?recommend=` tier and duration auto-selected, one **Create my code** button, full form behind **More options**. Creating from the loop records `growth.loop_code_created`. |
| Tests | `tests/integration/growth.test.ts` (new) | Shows once, never for code owners, dismisses for good, records loop_code_created. |

## Not done yet (this pass)

- The phone app (Expo) side of the prompt and quick-create.
- Playwright website flow and app e2e for this feature.
- Bundle-size measurements and screenshots.
