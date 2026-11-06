# Launch checklist

Public launch is a verdict, not a date. Every **blocker** must be ticked.

## Blockers

- [ ] **Legal review** by qualified counsel of the data-protection mapping for every market you launch in:
  - Eswatini Data Protection Act 2022, including registration as a data controller with ESCCOM.
  - Botswana Data Protection Act 2024.
  - South Africa's POPIA.
  - The GDPR, if EU users are possible.
- [ ] Legal review of the privacy notice (`/privacy` is a plain-language draft), the terms, and the lawful-request procedure for disclosures.
- [ ] **Independent penetration test against OWASP ASVS Level 2**, with no high or critical findings outstanding.
- [ ] `npm run verify:all` passes on the release build (tests, e2e, enumeration > 99.9% blocked, zero plaintext numbers, audit chain, p95 < 300 ms).
- [ ] Staging configured with `APP_ENV=staging`, real providers in sandbox, and https.
- [ ] KEK moved to a cloud KMS (`KeyProvider` implementation), with key rotation tested using `rewrap_keys`.
- [ ] `AUDIT_ANCHOR_DIR` on write-once storage; daily `audit:verify` alerting.
- [ ] Backups encrypted, kept for 35 days at most, and a restore tested.
- [ ] Two administrators and at least one moderator, with the moderation SLA (60 min) staffed.
- [ ] Resend: sending domain verified (SPF, DKIM, DMARC), a sending-only API key, `EMAIL_FROM` on that domain, and `npm run email:test` received.

## Before go-live, recommended

- [ ] Branding decision. "PryingEyes" reads as surveillance; test SafeDigits, CloakNumber or MaskLink with users.
- [ ] Accessibility review with screen-reader users (automated axe checks pass on key pages).
- [ ] siSwati / Setswana / isiZulu strings (`src/i18n`).
- [ ] Transparency report template (Phase 2 commitment).
- [ ] Brand guidance for users: the only real link format is `https://<your domain>/t/<code>`.
