# PryingEyes 0.6.0: no phone number needed, calls in the app only

## What changed

- **Codes work without a phone number.** A new code is *app-only* by default: people who pass the gate can **send a message** or **call in the app**. Nobody's number is involved.
- **Start sharing straight away.** Anyone who signs up (by phone or email) and confirms they're 18+ can:
  - create codes;
  - attach codes in groups;
  - approve requests;
  - see their activity.

  They don't need two-step sign-in or a number for any of this.
- **Showing a number is optional.** Under *Settings → Show my number*, an owner can set up two-step sign-in and add a number. They can then choose it when creating a code, so that people who pass the checks can see it once as a watermarked image.
- **Phone-network calls are gone.** All calls are in the app, over data, through your coturn server. These are removed:
  - the Africa's Talking voice integration and its webhook;
  - monthly call-minute caps;
  - the dev voice simulator;
  - the `relay_calls` table.
- **Simpler screens.**
  - *Dashboard* is now **My codes**.
  - **New code** asks for a name, where you'll share it, how careful to be and how long it should work.
  - Numbers are no longer in the main menu, and the old set-up wizard is optional.
  - In the app, the start screen leads with **Get started with my phone**.

The phone number used to sign up stays. It confirms one real person per account, which is what makes blocks and reports stick, and nobody ever sees it.

## Upgrading a running server

```bash
cd /opt/pryingeyes
# replace the code, keep .env
docker compose --profile app up -d --build      # applies migrations 0004 (optional numbers) and 0005 (drops the old call table)
```

Then tidy `.env`. These settings are no longer read, so remove them:

```ini
VOICE_PROVIDER=…
VOICE_WEBHOOK_SECRET=…
AT_VOICE_NUMBER=…
RELAY_MONTHLY_MINUTES=…
```

- **nginx:** the map simplifies to `map $request_uri $pe_loggable { ~^/t/ 0; ~^/g/ 0; default 1; }`.
- **Africa's Talking dashboard:** remove the voice callback URL and release the voice number if you bought one. SMS stays: it sends sign-in and gate codes.
- **Existing codes keep working.** Codes created before 0.6.0 are backed by a number, so their callers still see the "show the number" option. Any old phone-call option has simply disappeared.

## Tested

- **Server:** 171 tests pass, including 6 new ones for codes without a number:
  1. Create a code without two-step sign-in.
  2. Callers get only chat and in-app calls.
  3. Approving "show my number" on an app-only code becomes a plain approval.
  4. Codes backed by a number still require two-step sign-in.
  5. Pausing and revoking a code work without two-step sign-in.
  6. Anyone can attach an app-only code in a group.
- **Website end to end:** 15 tests pass, including a new one: sign up by text, create a code, then be reached by chat or call only.
- **App end to end:** 3 tests pass. The owner journey now creates a code before any number exists, then optionally adds one.
- **Checks:** the app's typecheck, lint, 12 unit tests, Android and iOS bundles, and the plaintext-at-rest scan all pass.
