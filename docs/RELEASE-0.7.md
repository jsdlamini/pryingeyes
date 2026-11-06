# PryingEyes 0.7.0: email only, no text messages

## What changed

- **No SMS at all.** PryingEyes no longer sends text messages, so there is no SMS provider to pay for or configure. Calls and chats were already in the app.
- **Sign-up is by email.** People create an account with an email and password. Passkeys and an authenticator app stay optional. Nobody sees anyone's email: people know each other by handle.
- **People come back to what they opened.** Someone who opens a contact code or a group invite while signed out signs up, confirms their email and signs in. They land straight back on that code or invite, already filled in, on the website and in the app.
- **Tier 2 and 3 codes are emailed.** Callers confirm a 6-digit code sent to their verified email.
- **Alerts go in the app and by email.** This includes security alerts such as a frozen code.
- **New setting: `RL_SIGNUP_PER_IP_HOUR`** (default 30). Many people can share one network address (a campus, an office or a mobile network), so the sign-up limit per address is now adjustable.
- **Removed:**
  - phone sign-up and sign-in, and adding a phone to an account;
  - the Africa's Talking integration;
  - `SMS_PROVIDER`, `AT_USERNAME`, `AT_API_KEY`, `AT_SMS_FROM`, `AT_SANDBOX` and `SMS_ALERTS_PER_DAY`.
- **Kept:** the optional *Show my number* feature. An owner can still add a number that approved people may see once, as a watermarked image. It never sends a text message.

## Your `.env`

The YOUR SETTINGS block at the top of `.env` now holds only:

| Setting | Needed for |
|---|---|
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | Email: confirmation links, codes, alerts |
| `CAPTCHA_PROVIDER`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | The human check (production) |
| `DEFAULT_COUNTRY` | The country picker for the optional *Show my number* field |

The phone-app link settings moved down to the server settings, since they're only needed for store builds. Run `./start.sh check` to see what's in use.

**Before the first run, `pryingeyes.dev` must be a verified domain in Resend** (Domains → Add domain, then add the SPF and DKIM records it shows to your DNS). Until it is, Resend refuses to send from `no-reply@pryingeyes.dev`.

## Upgrading

```bash
./start.sh setup     # local: fresh database, your YOUR SETTINGS block kept
```

On a server, rebuild as usual (`docker compose --profile app up -d --build`), then delete the `SMS_PROVIDER`, `AT_*` and `SMS_ALERTS_PER_DAY` lines from `.env`.

Accounts that were created with a phone number only, and no email, can no longer sign in. Before launch that affects only test accounts, so a fresh database is simplest.

## Tested

- **Server:** 166 tests pass. New tests check that:
  - sign-up links keep the code or invite (local paths only);
  - no text message is ever sent, even for security alerts;
  - every caller flow now runs through email.
- **Website end to end:** 15 tests pass. Callers sign up from a code's gate, confirm their email and land back on the same code.
- **App end to end:** 3 tests pass, including signing up from an invite link and returning to the join screen.
- **App:** typecheck, lint and unit tests (12) pass.
