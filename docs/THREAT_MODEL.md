# Threat model (Phase 1)

Method: STRIDE plus contact-privacy abuse cases (stalking, scraping, SIM swap, insider misuse). Each threat maps to the control that implements it and the automated test that proves it.

| ID | Threat | Impact | Implemented controls | Proven by |
|---|---|---|---|---|
| T1 | Offline brute force of a token | Critical | Codes are 80-bit (link) and 50-bit (short) CSPRNG Crockford strings and carry nothing about the number. The number→token mapping is server-side only. | `foundation.test.ts` (entropy, uniformity, no collisions); `gate.test.ts` (codes absent from DB dump) |
| T2 | Enumeration and scraping | High | Keyed HMAC lookup; uniform `unavailable` body plus a fixed 200 ms floor. Budgets per IP (30/h), per caller (10/day), per caller-token (3/day) and per token (50/day). Lockout after 5 failures (1 h, doubling to 24 h), token freeze after 10, in-flight cap of 2. | `gate.test.ts` (identical bodies, timing floor, lockout, burst); `npm run attack:enumerate` (99.95% blocked, 0 found) |
| T3 | Owner account takeover | Critical | Argon2id; MFA (passkey or TOTP) required before storing numbers or issuing tokens; device-bound sessions with a 12 h idle timeout; step-up for sensitive actions; generic login errors; login rate limits. | `accounts.test.ts` (MFA flow, TOTP replay, device binding, idle expiry, rate limits); e2e passkey sign-in |
| T4 | SIM swap against owner | High | Recovery never uses SMS (PryingEyes sends none): passkey or recovery code, plus a 24 h cooldown and alerts to every device. Nothing about the account depends on owner features without MFA. | `accounts.test.ts` (recovery start, cooldown, cancel) |
| T5 | Stalking via repeated requests | High | Tier 3 consent with in-app contact as the default; decline-and-block; per-caller caps; the owner sees every attempt; signed evidence packs. | `gate.test.ts` (Tier 3 flows, decline/block); `safety.test.ts` (evidence signing and tamper detection) |
| T6 | Insider or admin misuse | High | Dual-control break-glass; every action hash-chained. Moderators never see numbers. Decryption is confined to `vault.decryptNumberFor` for reveal and export only. | `safety.test.ts` (dual control, moderation view has no numbers) |
| T7 | Database or backup exfiltration | Critical | AES-256-GCM per-user data keys, wrapped by the KEK and bound to the row id (AAD). Tokens stored as HMACs; free text encrypted. Erasure deletes the data key (crypto-shredding). | `audit-vault.test.ts` (ciphertext only, row binding); `npm run scan:plaintext` |
| T8 | Phishing via share links or clone pages | Medium | One canonical link format `/t/<code>` with no parameters; brand guidance in the launch checklist. HMAC-signed links were not built: the code is already the secret. | — (process control) |
| T9 | Harassment through chat | High | Block (both directions); report with only the messages the reporter chooses; moderation queue with a 60-min SLA flag; 24 h disappearing messages at Tier 3; send rate limits; no attachments. | `safety.test.ts` (chat, block, report, disappearing, flood limit) |
| T10 | API abuse and denial of service | Medium | Layered quotas; body-size limit; WAF recommended in `DEPLOY.md`. | `npm run load:test` (p95 216 ms at 50 rps) |
| T11 | Cross-site request forgery | Medium | Origin / Sec-Fetch-Site check on every mutating request; SameSite=Lax HttpOnly cookies. | `accounts.test.ts` (cross-site request blocked) |
| T12 | XSS and clickjacking | Medium | Nonce-based strict CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`; React escaping; no `dangerouslySetInnerHTML`. | Response headers (checked during build verification) |
| T13 | Number leakage via logs | High | All log fields and messages pass through the redactor (phone shapes, token paths, sensitive keys). | `foundation.test.ts` (redaction); `npm run scan:plaintext` over logs |
| T14 | Reveal redistribution | Medium | Server-rendered PNG only (never text), watermarked with the viewer and time; one-time 60 s grant; `no-store`; shown from a `blob:` URL and released after 60 s. | `gate.test.ts` (single-use, no-store, no number bytes); e2e (no number text in page) |

## Residual risks

- **Screenshots and photos of a reveal** can't be prevented; the watermark deters and attributes them. Tier 3 or Tier 4 avoid reveals entirely.
- **Sybil callers:** email addresses are cheap, so many accounts can multiply the per-caller budgets. Per-IP sign-up and gate budgets, per-token budgets, Tier 3 consent and token freezing bound the damage. Disposable-email blocking and account-age weighting are Phase 2 items.
- **Local KEK:** with `LocalKeyProvider`, whoever holds `.env` holds the KEK. Production should use a cloud KMS (see `DEPLOY.md`).
- **Trust in the edge for client IPs:** set `TRUST_PROXY_HOPS` to match your proxy chain, otherwise IP budgets can be dodged with a forged `X-Forwarded-For`.
