# Running PryingEyes with Docker (production)

Live address: **https://pryingeyes.idealsoftwaresolutions.com**

`docker-compose.prod.yml` runs two containers, and nothing else is needed:

| Container | What it is | Reachable on |
|---|---|---|
| `pryingeyes-app-1` | The website, with its built-in database and cache. It also applies database updates and runs the background jobs. | `127.0.0.1:${PE_PORT}` (default 3100), for your reverse proxy |
| `pryingeyes-coturn-1` | The call relay for in-app calls | host ports 3478 (udp+tcp) and 49152–65535/udp |

All data is in one Docker volume, `pryingeyes_pe-data`: the database, the audit anchors and the logs. The settings are in `.env` beside the compose file. **Back up the volume and `.env` together**: the keys in `.env` unlock the data.

## Behind Cloudflare

- **Website hostname:** proxied (orange cloud). Your reverse proxy forwards it to `127.0.0.1:3100`. Requests pass Cloudflare and then the proxy, so set `TRUST_PROXY_HOPS=2`.
- **Relay hostname (`TURN_HOST`, e.g. `turn.idealsoftwaresolutions.com`):** must be **DNS-only (grey cloud)**, pointing at the server's IP. Cloudflare's proxy can't carry the relay's UDP traffic. The relay runs without TLS on port 3478; call audio is end-to-end encrypted anyway.

## First start

```bash
cd /opt/pryingeyes            # the unpacked project
# 1. Create .env with fresh keys (uses a throwaway Node container; nothing installed on the host)
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/w -w /w node:22-bookworm-slim node scripts/prepare.mjs
chmod 600 .env
# 2. Edit .env:
#    TRUST_PROXY_HOPS=2, TURN_HOST=turn.idealsoftwaresolutions.com,
#    TURN_URLS=turn:<TURN_HOST>:3478?transport=udp,turn:<TURN_HOST>:3478?transport=tcp
#    and the YOUR SETTINGS block: ADMIN_EMAILS, Resend, Turnstile
# 3. Build and start
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps        # app shows (healthy) after ~30 s
docker compose -f docker-compose.prod.yml logs app | grep "PryingEyes"
```

The app's log should show `PryingEyes ready: production at https://pryingeyes.idealsoftwaresolutions.com; database built in; cache built in`. If a setting is missing, the container stops after printing `PryingEyes can't start:` and the list to fix.

## Day to day

```bash
C="docker compose -f docker-compose.prod.yml"
$C logs -f app                                  # website log
$C restart app                                  # after editing .env
$C exec app npx tsx scripts/verify-audit-chain.ts   # scripts run INSIDE the app container
```

The built-in database belongs to the website process. Run scripts with `exec` in the running container, as above. Don't start a second container with `run`: it's refused while the website is up, which protects the data.

## Updating

```bash
# replace the code (unzip / git pull), keeping .env
docker compose -f docker-compose.prod.yml up -d --build    # database updates apply on start
```

## Backup and restore

```bash
# nightly (cron), a few seconds of downtime while the database files are copied
C="docker compose -f /opt/pryingeyes/docker-compose.prod.yml"
$C stop app && docker run --rm -v pryingeyes_pe-data:/data:ro -v /var/backups/pryingeyes:/b alpine \
  tar czf /b/pe-data-$(date +%F).tgz -C /data . && cp /opt/pryingeyes/.env /var/backups/pryingeyes/env-$(date +%F) && $C start app
```

To restore:
1. Stop the app.
2. Unpack the archive into the volume:
   ```bash
   docker run --rm -v pryingeyes_pe-data:/data -v /var/backups/pryingeyes:/b alpine sh -c 'rm -rf /data/* && tar xzf /b/pe-data-DATE.tgz -C /data'
   ```
3. Put back the matching `.env`.
4. Start the app.

## Growing later

When one website container is no longer enough, add PostgreSQL and Redis containers and set `DATABASE_URL` and `REDIS_URL` in `.env`; the website creates its tables there on the next start. The development `docker-compose.yml` has working definitions for both. Moving existing data across is a one-off export and import.
