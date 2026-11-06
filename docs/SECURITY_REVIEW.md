# Security self-review (pre-pentest)

This is the builder's own review, written to brief the independent penetration testers. It does not replace their test.

## Where to look first

1. **`src/lib/gate.ts`** — the decode gate. Check ordering, uniform responses and budget accounting. The `outcomeCounted` compare-and-set, `chooseOutcome` re-checking token status, and the in-flight cap are the subtle parts.
2. **`src/lib/vault.ts`** — the only encrypt/decrypt path for numbers. Check that `decryptNumberFor` is called only from reveal and data export (`grep -rn decryptNumberFor src`).
3. **`src/lib/session.ts` and `src/lib/auth.ts`** — session binding, MFA-pending sessions, step-up windows, and the post-panic step-up rule (`assertNotDuringPanicWithoutStepUp`).
4. **`src/lib/accounts.ts`** — sign-up never reveals whether an email is registered (the real owner is emailed instead). Recovery has a cooldown.
5. **`src/lib/http.ts` `checkOrigin`** — every state-changing route checks the Origin, except requests from the phone app that carry no cookie (bearer sessions).
6. **`src/middleware.ts`** — CSP and headers.

## Findings fixed during the build

| Finding | Fix |
|---|---|
| A burst of parallel gate requests could evaluate about 10 guesses before the 5-failure lockout applied. | Per-caller in-flight cap (2) and a regression test (`gate.test.ts`). |
| Phone-shape detection matched Postgres microsecond timestamps, and epoch-ms log times. | ISO timestamps excluded from matching; logs use ISO times. |
| `next start` in a desktop test run looked like production. | `APP_ENV` introduced; stand-ins refused unless `APP_ENV=development`. |
| `upgrade-insecure-requests` and HSTS on plain-http localhost would break local testing. | Both sent only when `APP_URL` is https. |
| PostCSS < 8.5.23 (via Next 15) had high-severity advisories. | npm `overrides` pins 8.5.32; `npm audit --omit=dev` is clean. |
| A test showed the dashboard's light grey text failing WCAG contrast (2.7:1). | Token darkened to 5.3:1. |

## Residual risks and recommendations

- **Local KEK.** Move to a cloud KMS before production (see `DEPLOY.md`).
- **Sybil callers.** Many email accounts multiply per-caller budgets. Phase 2: disposable-email blocking, account-age weighting, and tighter per-token budgets at Tier 2 and above.
- **Code display.** Codes can't be re-shown (stored as HMACs only), so owners who lose them must rotate. This is a deliberate trade-off (see `ASSUMPTIONS.md` #7).
- **Voice webhook secret** sits in the callback URL. Keep that URL out of logs (nginx config provided) and restrict by source IP if possible.
- **Region accuracy** is country-level, from an edge header or the caller's phone country.
- **No server-side malware or abuse scanning of chat**, by design (rule 10). Attachments are disabled.
- **Admin bootstrap** (`npm run admin:create`) needs shell access. Protect the server accordingly; every use is audited.

## Verification evidence

See `FINAL_REPORT.md` for the commands and results: unit and integration tests, browser end-to-end tests, enumeration campaign, plaintext scan, audit-chain verification, load test and dependency audit.
