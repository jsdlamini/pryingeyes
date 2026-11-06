# Final report — Phase 1 (M0–M7)

Prepared against *PryingEyes — Development Agent Prompt v1.1*. The product owner asked for the whole build in one pass, so the six STOP reports are consolidated here (see `ASSUMPTIONS.md` #1).

## Verification results (final run, 3 Nov 2026)

| Acceptance criterion | Command | Result |
|---|---|---|
| All tests green | `npm test` | **106 / 106 passed** (23 unit, 83 integration on real PostgreSQL + Redis) |
| Browser journeys | `npm run test:e2e` | **7 / 7 passed** (passkey onboarding, Tier 1 reveal, Tier 3 consent → relay → panic, chat, passkey sign-in, accessibility, mobile layout) |
| Enumeration blocked > 99.9% | `npm run attack:enumerate` | **99.95% blocked**; 5 of 10,000 guesses evaluated; **0 successful** |
| Zero plaintext numbers | `npm run scan:plaintext` | **Pass**: 80 stored numbers × 5 formats searched across 952 rows in 23 tables and 269 log lines; 0 findings |
| Audit chain verifies | `npm run audit:verify` | **Pass**: 264 events, every link and anchor |
| Decode-gate p95 < 300 ms at 10× peak | `npm run load:test` (50 rps × 30 s) | **p95 222 ms** (200 ms floor + ~22 ms work); p50 208 ms; p99 797 ms (cold-start outliers) |
| WCAG 2.1 AA on caller flows | axe in e2e | **No serious or critical violations** on `/`, `/signup`, `/login`, `/privacy`, `/t/<code>` |
| Dependency vulnerabilities | `npm audit --omit=dev` | **0** |
| Type-check, lint, production build | `npm run typecheck`, `lint`, `build` | **Clean** |
| Independent ASVS L2 pen test | — | **Not done** — human go-live gate (see `LAUNCH_CHECKLIST.md`) |

## Milestone reports

**M0 Foundations**
- **Built:** repository; Drizzle schema and migrations (23 tables); an append-only audit trigger; zod-validated config with production guards; a redacting logger; the `KeyProvider` interface with a local implementation; AES-256-GCM helpers; a CI workflow (secret scan, dependency scan, Semgrep SAST, tests, plaintext scan, e2e).
- **Tests:** crypto, redaction, KEK rotation, TOTP vectors, audit chain incl. concurrency and tamper detection.
- **Security notes:** audit rows can't be updated or deleted at the database level, except nulling a payload.

**M1 Accounts, MFA, sessions, recovery, vault**
- **Built:** email sign-up with verification links; the one-step phone path for callers; Argon2id; TOTP with replay protection; passkeys (WebAuthn, user verification required); recovery codes; recovery with a 24 h cooldown and alerts; device-bound sessions with a device list; step-up; E.164 normalisation, blind index, per-user envelope-encrypted vault.
- **Tests:** 16 account tests (enumeration resistance, rate limits, cross-site request blocking, recovery) plus the e2e passkey journeys.

**M2 Tokens**
- **Built:** all four classes; link, short code and QR; pause, resume, rotate, extend, clone and revoke; the 10-per-number cap; tier recommendation by context; Tier 4 shown as "Coming soon".
- **Tests:** entropy, codes absent from storage, cap, rotation, expiry, disposable consumption.

**M3 Decode gate (Tiers 1–2), reveal, budgets, audit** — STOP: security review of the gate
- **Built:** check ordering; uniform responses; a 200 ms floor; IP, caller, caller-token and token budgets; lockouts with doubling; token freeze with an SMS alert; an in-flight cap; a server-rendered watermarked PNG on a single-use 60 s grant.
- **Tests:** identical bodies for unknown, paused, revoked, frozen and blocked codes; timing floor; lockout; burst; immediate revocation; Tier 2 OTP and daily cap.
- **Security notes:** CAPTCHA runs before the token lookup (`ASSUMPTIONS.md` #5).

**M4 Tier 3 consent, relay, notifications, cost caps**
- **Built:** consent requests with a 280-character note; four owner decisions; 24 h expiry; decline-and-block; relay through a mock or Africa's Talking (whisper → press 1 → dial, platform caller ID both ways, metadata only); monthly minute caps with an 80% alert; email, in-app and capped SMS notifications.
- **Tests:** every decision path, expiry, the owner-only rule, relay events with idempotency, cap, phone requirement, and the AT webhook XML.

**M5 Chat, moderation** — STOP
- **Built:** per-token conversations encrypted at rest; 24 h disappearing messages at Tier 3; read receipts (can be turned off); block; report with chosen messages only; moderation queue with a 60-min SLA flag; dismiss, warn, close and suspend.
- **Tests:** encryption at rest, outsider access denied, disappearing and purge, block both ways, flood limit, moderators never see numbers.

**M6 Dashboard, evidence, panic, data rights, retention, admin**
- **Built:** live audit feed; Ed25519-signed evidence JSON plus PDF and a public verify endpoint; panic revoke-all (under 1 s, no step-up; step-up needed after); data export and erasure (crypto-shredding, chain still verifies); retention worker; daily write-once anchors; dual-control break-glass.
- **Tests:** signature valid and tamper detected, erasure leaves no rows or payloads, retention, dual control, step-up on admin actions.

**M7 Hardening** — STOP: final report
- **Built:** the enumeration, plaintext-scan, audit-verify and load-test scripts; Playwright e2e with a virtual authenticator and axe; docker-compose; Dockerfile; docs.
- **Tests:** see the table above.
- **Assumptions:** 21 recorded in `ASSUMPTIONS.md`; the ⚠ items need a human decision.

## Questions for the product owner

1. **Codes shown once (`ASSUMPTIONS.md` #7).** Keep this (strictest), or store codes encrypted so owners can copy a link again later?
2. **Drizzle instead of Prisma (#2).** Accept, or port back to Prisma?
3. **Launch markets.** The legal mapping covers Eswatini, Botswana, South Africa and the EU. Confirm which apply for counsel's review.

## Next

Close the human gates in `LAUNCH_CHECKLIST.md`: legal review, the independent ASVS L2 penetration test, KMS, and staging with real providers. Then start Phase 2 (Tier 4 Vault, end-to-end encrypted chat, PWA, decoy tokens).
