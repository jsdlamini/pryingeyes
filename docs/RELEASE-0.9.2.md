# PryingEyes 0.9.2: site address up front

## What changed

- **The site address is the first setting in `.env`.** `APP_ENV` and `APP_URL` now open the YOUR SETTINGS block, under *Site address*. Before, they sat in the server section further down. `APP_URL` is the base of every link the server sends: email confirmations, `/t/<code>` contact links, `/g/<invite>` invites and QR codes.
- **One address to set, not two.** `RP_ID` (the passkey domain) can now be left empty, and it then follows `APP_URL`'s host. Set it only if you want passkeys shared with a parent domain.
- **Clearer production checks.** With `APP_ENV=production` the server won't start if:
  - `APP_URL` isn't `https`;
  - `APP_URL` is still `localhost`;
  - `RP_ID` doesn't match `APP_URL`'s host or a parent domain of it.
- **`./start.sh check`** now prints the site address and mode, and warns about the same problems.
- **`./start.sh setup`** keeps `APP_ENV`, `APP_URL` and `RP_ID` when it rebuilds `.env`.

## Upgrading an existing `.env`

You don't need to move anything: the server reads `APP_URL` wherever it sits in the file. On your server, set:

```ini
APP_ENV=production
APP_URL=https://pryingeyes.yourdomain.com
RP_ID=
```

Leaving `RP_ID` empty is the simplest choice. If you already set it to your subdomain, that works too.

## Tested

- Server: 172 tests pass.
- The new production checks were tried with:
  - a subdomain (accepted);
  - localhost (refused);
  - an unrelated `RP_ID` (refused);
  - a parent-domain `RP_ID` (accepted).
