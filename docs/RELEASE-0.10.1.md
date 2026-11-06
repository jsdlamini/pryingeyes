# PryingEyes 0.10.1: production Docker setup

## What changed

- **`docker-compose.prod.yml`** runs PryingEyes the way your other subdomains run, as two containers:
  - **`app`:** the website, with its built-in database and cache. All data is in the volume `pryingeyes_pe-data`. It listens on `127.0.0.1:${PE_PORT}` (default 3100) for your reverse proxy.
  - **`coturn`:** the call relay, on the host network, without TLS. Its hostname (`TURN_HOST`) must be DNS-only (grey cloud) in Cloudflare.

  No PostgreSQL or Redis containers.
- **Health check:** `/api/health` reports whether the server has started and the database answers. Docker uses it, so `docker compose ps` shows `healthy`.
- **Keys must match the data.** The website stores a fingerprint of its keys beside the data. It refuses to start if `.env`'s keys ever change, for example after a lost `.env` was regenerated, and asks for the matching backup. That protects the data even inside a Docker volume, where the first-run check can't see it.
- **Database lock works across containers.** A script started in a second container is refused while the website runs (scripts belong in `docker compose exec app …`). After a container restart, a reused process ID no longer blocks the database. Closing the database while it's still opening no longer hangs.
- **New settings in `.env`:** `TURN_HOST`, `TURN_EXTERNAL_IP` (only behind NAT) and `PE_PORT`.
- **Docs:**
  - **`docs/DEPLOY-DOCKER.md`:** the human guide (first start, day to day, updates, backup and restore).
  - **`docs/DEPLOY-AGENT-INSTRUCTIONS.md`:** step-by-step instructions for a coding agent on your own computer that deploys over SSH, with Cloudflare handling DNS and certificates.

## Tested

- **Server: 175 tests pass**, both on PostgreSQL and Redis servers and on the built-in database and cache.
- **The production build, started as the container starts it**, passes:
  - settings only from the environment, with no `.env` file in the folder;
  - the database in an absolute data folder;
  - the health check returns `{"ok":true}`.
- **Lock, checked in four situations:**
  - a live lock from another container: refused;
  - a stale lock from another container: taken over;
  - a reused process ID after a restart: taken over;
  - reopening a populated database: works.
- **Keys:** wrong keys on existing data are refused, and the right keys start normally.
- **Compose:** `docker compose -f docker-compose.prod.yml config` validates, and the relay's command line receives the secret, host and optional external IP.
- **Not tested here: building the image itself.** This environment can't reach Docker Hub. The Dockerfile is the one used since 0.5, with small changes: a data folder, the health check, and an explicit `-H 0.0.0.0`. The agent instructions stop and report if the build fails.
