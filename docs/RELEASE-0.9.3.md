# PryingEyes 0.9.3: live address

The live address is now **https://pryingeyes.idealsoftwaresolutions.com**.

## What points at it

- **`.env.example`** is now set up for the live server:
  - `APP_ENV=production` and `APP_URL=https://pryingeyes.idealsoftwaresolutions.com`;
  - `TURN_URLS` points at the call relay on the same host;
  - `TURN_CONFIG` and `TURN_CERTS` use the production relay with its Let's Encrypt certificate;
  - `MOBILE_DEV_ORIGINS` is empty.
- **`docker/turnserver.prod.conf`**: `realm`, `server-name` and the certificate paths use the live host.
- **`docs/DEPLOY-SUBDOMAIN.md`**: every command and config block (nginx, certbot, checks, app links) uses the real host. You can paste them as they are.
- **Phone app store builds** (`preview` and `production` in `mobile/eas.json`) connect to the live server and open its `/t/` and `/g/` links.

## On the server

```bash
cp .env.example .env && npm ci && npm run keys:generate && chmod 600 .env
```

Then fill in the four settings only you have:
- `RESEND_API_KEY`;
- `EMAIL_FROM`, on a domain you've verified in Resend;
- `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET`.

Also set `EMAIL_PROVIDER=resend` and `CAPTCHA_PROVIDER=turnstile`. Until those are in, the server won't start, and it lists exactly what's missing.

## On a laptop

Nothing changes. `./start.sh setup` switches its copy of `.env` back to `development`, `http://localhost:3000` and the local call relay.

## Before going live

- DNS: an `A` record for `pryingeyes.idealsoftwaresolutions.com` pointing at the server.
- In Cloudflare Turnstile, add that hostname to the widget.
