# PryingEyes 0.10.0: a self-contained website

The website now runs as a plain Next.js app. You don't need `start.sh`, Docker, PostgreSQL or Redis:

```bash
npm install
npm run dev                      # this computer: http://localhost:3000

npm ci && npm run build
npm start -- -p 3100 -H 127.0.0.1   # server, behind nginx
```

## What changed

- **Built-in database.** When `DATABASE_URL` is empty, PostgreSQL runs inside the website (PGlite, PostgreSQL 18). Its files are kept in `DATA_DIR` (`var/data/postgres`). The schema, triggers and every feature are the same as on a PostgreSQL server.
- **Built-in cache.** When `REDIS_URL` is empty, rate limits, call signalling and passkey challenges are held in memory. They reset when the website restarts.
- **Sets itself up.** The first `npm run dev`, `npm run build` or `npm start`:
  - creates `.env` from `.env.example` (with `npm run dev` it uses this computer's settings);
  - fills in fresh secret keys, never replacing an existing one.

  If `.env` or its keys are missing but the database already holds data, it stops and asks for your backup. New keys would leave that data unreadable.
- **Starts itself.** When the server starts it:
  - checks the settings, listing anything unsafe for production;
  - applies database migrations;
  - runs the background jobs (expiring codes and messages, missed calls) in the same process.

  There's no separate worker (`BACKGROUND_JOBS=on`).
- **First admins from settings.** Put your email in `ADMIN_EMAILS`. Once that account confirms its email, it becomes an admin, recorded in the audit chain. No server command is needed.
- **One process owns the built-in database.** Scripts such as `npm run seed` and `npm run admin:create` refuse with a clear message while the website is running. Stop it first, or use an external `DATABASE_URL`.
- **Deployment guide rewritten** (`docs/DEPLOY-SUBDOMAIN.md`): Node 22, a systemd service, coturn from Ubuntu's packages, nginx, nightly backups. Docker stays as an alternative.
- **Still optional:**
  - `start.sh` and Docker, for the containers and the phone-app modes;
  - `DATABASE_URL` and `REDIS_URL`, for running several copies of the app.

## What still needs its own service

**In-app calls need the coturn relay**, because a relay can't run inside Node. On a server, `sudo apt install coturn` (guide §2). Chats, groups and codes work without it.

## Upgrading from 0.9.x

- **You use Docker (`docker compose --profile app`):** nothing changes. The compose file still sets `DATABASE_URL` and `REDIS_URL` for the containers.
- **You switch to the plain Node setup:** your existing `.env` keeps working. To use the built-in database, empty `DATABASE_URL` and `REDIS_URL`. It starts empty, so do this before you have users, or move the data across first.

## Tested

- **Server: 175 tests**, run twice: once on PostgreSQL and Redis servers, once on the built-in database and in-memory cache. Both pass. New tests cover `ADMIN_EMAILS` and the in-memory cache.
- **Website end-to-end: 16 pass, 1 skipped.** These ran against a fresh copy started with only `npm run build` and `npm start`: no `.env`, no Docker, no database or Redis server. That includes a full in-app call through the relay.
- **Checked by hand:**
  - a script is refused while the website holds the database;
  - production settings without provider keys stop the server with the exact list;
  - new keys are refused when data already exists.
- Typecheck, lint and the plaintext scan are clean.
