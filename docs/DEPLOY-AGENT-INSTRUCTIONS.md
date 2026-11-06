# Agent instructions: deploy PryingEyes with Docker

Copy everything below the line into the coding agent on **your own computer** (the one with the project zip). First fill in the values in **Before you start**. The agent works on the server over SSH.

---

You are deploying **PryingEyes**, a Next.js 15 website, to a remote Ubuntu server, working from this local computer over SSH. The server already runs several other subdomains, all in Docker, behind a reverse proxy. Those sites must keep working. PryingEyes becomes one more subdomain: `pryingeyes.idealsoftwaresolutions.com`.

The project ships its own production Docker setup, `docker-compose.prod.yml`. It has two containers:
- **`app`:** the website. Its PostgreSQL (PGlite) and cache are built in. It applies database updates and runs its background jobs itself. Its data lives in the Docker volume `pryingeyes_pe-data`.
- **`coturn`:** the call relay. It runs on the host network: ports 3478 udp+tcp and 49152–65535/udp.

Don't add PostgreSQL, Redis or any other container. The project's own guide for this setup is `docs/DEPLOY-DOCKER.md`.

## Before you start (filled in by the owner)

| Value | Meaning |
|---|---|
| `PROJECT_ZIP` = `<local path, e.g. ~/Downloads/pryingeyes-0.10.1.zip>` | the release to deploy |
| `SSH_TARGET` = `<e.g. deploy@203.0.113.10>` | how to reach the server; this user can run `docker` and `sudo` |
| `TURN_HOST` = `<e.g. turn.idealsoftwaresolutions.com>` | the call relay's hostname: a **DNS-only (grey cloud)** A record pointing at the server's public IP |

## How the owner has set things up (don't change any of it)

- **DNS and certificates are handled in Cloudflare by the owner.** `pryingeyes.idealsoftwaresolutions.com` is **proxied** (orange cloud). Don't run certbot. Don't create, request or change certificates, and don't touch Cloudflare.
- **`TURN_HOST` is DNS-only**, because Cloudflare's proxy can't carry the relay's UDP traffic. The relay runs without TLS on port 3478. That's intended: call audio is already end-to-end encrypted, and relay access uses short-lived HMAC credentials.

## Rules

1. **Leave the other sites alone.** Don't stop, restart, recreate or edit other containers, compose projects, networks or volumes. Don't run `docker system prune`, `docker volume prune` or `docker network prune`. Don't run `docker compose down` in any project other than PryingEyes.
2. **Reverse proxy changes are additive.** Add one new site or route for PryingEyes and nothing else. Validate before you reload (for nginx, `nginx -t`). Use a graceful reload, never a restart.
3. **Secrets stay on the server.** Never print, `cat`, copy to this computer, or paste into chat the contents of `/…/pryingeyes/.env`. To check that a value is set, print only `set` or `EMPTY`.
4. **Never regenerate or delete keys or data.** Don't delete or recreate `.env` once it exists. Don't remove the `pryingeyes_pe-data` volume. If the app ever logs `The keys in .env don't match the data`, stop and tell the owner. Don't try to fix it.
5. **The owner types the provider keys.** At step 5, stop and ask the owner to type the provider keys into `.env` on the server themselves. Don't ask for them in chat.
6. **Read before you change.** Before changing anything on the server, look first and report what you found: the steps below begin with inspection.
7. **On failure, stop and report.** If anything fails or doesn't match what's described here, report the exact command and output and stop. Don't improvise with other software, ports or approaches.

## Steps

### 1. Local checks

```bash
ls -l PROJECT_ZIP
unzip -l PROJECT_ZIP | grep -E "docker-compose.prod.yml|Dockerfile|scripts/prepare.mjs"   # all three must be present
ssh -o BatchMode=yes SSH_TARGET 'echo connected; hostname; whoami'
dig +short TURN_HOST || nslookup TURN_HOST
dig +short pryingeyes.idealsoftwaresolutions.com
```

- `TURN_HOST` must resolve to the server's own public IP. If it resolves to a Cloudflare address (for example `104.16–104.31.x.x`, `172.64–172.71.x.x` or `188.114.x.x`), stop. Tell the owner the record must be DNS-only (grey cloud).
- The website hostname should resolve to Cloudflare addresses. That's expected.

### 2. Inspect the server (read only)

```bash
ssh SSH_TARGET '
  set -x
  docker version --format "{{.Server.Version}}"; docker compose version
  docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"
  docker network ls
  ls -d /opt/* /srv/* ~/apps/* ~/docker/* 2>/dev/null
  sudo ss -ltnup | grep -E ":(80|443|3100|3478)\b"
  curl -s https://ifconfig.me; echo; hostname -I
  sudo ufw status 2>/dev/null | head -5
  systemctl is-active nginx 2>/dev/null; ls /etc/nginx/sites-enabled 2>/dev/null
'
```

From the output, work out and report to the owner:

- **Where the other apps' compose projects live**, e.g. `/opt/<app>` or `/srv/<app>`. Use the same parent folder for PryingEyes; call it `APP_DIR`, e.g. `/opt/pryingeyes`.
- **The reverse proxy** in front of the other subdomains. It's one of:
  - **(A)** nginx installed on the host (`systemctl is-active nginx` says `active`);
  - **(B)** nginx running in a container, owning ports 80/443;
  - **(C)** something else: Traefik, Caddy, Nginx Proxy Manager, etc.
- **How the other subdomains handle HTTPS at the origin:**
  - a Cloudflare Origin Certificate, often a wildcard `*.idealsoftwaresolutions.com`, and the path it's at;
  - or plain HTTP on port 80 (Cloudflare "Flexible").

  Read one existing subdomain's proxy config to see this.
- **Ports:** whether 3100 and 3478 are free. If 3100 is taken, choose a free port and use it as `PE_PORT` below. If 3478 is taken, stop and report.
- **NAT:** whether the server is behind NAT. If the public IP from `ifconfig.me` isn't in `hostname -I`, it is, and you'll need `TURN_EXTERNAL_IP` in step 4.

If the proxy is **(C)**, stop after this step. Report what you found, and propose the exact route you'd add (to `127.0.0.1:PE_PORT`, or to container `pryingeyes-app-1:3000`). Wait for the owner's go-ahead.

### 3. Upload the code

```bash
scp PROJECT_ZIP SSH_TARGET:/tmp/pryingeyes.zip
ssh SSH_TARGET '
  set -e
  test ! -e APP_DIR/.env || { echo "APP_DIR/.env already exists: this is an update, not a first install. Stop."; exit 1; }
  sudo mkdir -p APP_DIR && sudo chown "$(id -u):$(id -g)" APP_DIR
  cd /tmp && rm -rf pe-unpack && mkdir pe-unpack && unzip -q pryingeyes.zip -d pe-unpack
  SRC=$(dirname "$(find pe-unpack -maxdepth 2 -name docker-compose.prod.yml | head -1)")
  cp -a "$SRC"/. APP_DIR/ && rm -rf pe-unpack pryingeyes.zip
  ls APP_DIR/docker-compose.prod.yml APP_DIR/.env.example
'
```

If `.env` already exists, follow **Updating** at the end instead.

### 4. Create `.env` on the server, then set the server-specific lines

This uses a throwaway Node container, so nothing is installed on the host. It creates `.env` from `.env.example` with fresh secret keys. That file is already set for production at `https://pryingeyes.idealsoftwaresolutions.com`, with the built-in database and cache.

```bash
ssh SSH_TARGET '
  set -e; cd APP_DIR
  docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/w -w /w node:22-bookworm-slim node scripts/prepare.mjs
  chmod 600 .env
  setv() { if grep -q "^$1=" .env; then sed -i "s#^$1=.*#$1=$2#" .env; else echo "$1=$2" >> .env; fi; }
  setv TRUST_PROXY_HOPS 2
  setv TURN_HOST TURN_HOST
  setv TURN_URLS "turn:TURN_HOST:3478?transport=udp,turn:TURN_HOST:3478?transport=tcp"
  setv PE_PORT PE_PORT_CHOSEN_IN_STEP_2
  # only if behind NAT (step 2): setv TURN_EXTERNAL_IP "<public-ip>/<private-ip>"
  grep -E "^(APP_ENV|APP_URL|TRUST_PROXY_HOPS|TURN_HOST|TURN_URLS|PE_PORT|DATABASE_URL|REDIS_URL)=" .env
'
```

Those lines contain no secrets, so it's fine to show them. Expect:
- `APP_ENV=production`;
- `APP_URL=https://pryingeyes.idealsoftwaresolutions.com`;
- `DATABASE_URL=` and `REDIS_URL=` both empty (built in).

`TRUST_PROXY_HOPS=2` is needed because requests pass Cloudflare and then the reverse proxy. It's how the app finds visitors' real IPs for its rate limits.

**Proxy in a container (B)?** Don't change `PE_PORT`. You'll connect the app to the proxy's network in step 7.

### 5. Pause: the owner fills in their settings

Stop and tell the owner:

> Please run `ssh SSH_TARGET`, then `nano APP_DIR/.env`. In the **YOUR SETTINGS** block at the top, set:
> - `ADMIN_EMAILS=` your email (your account becomes admin once you confirm it);
> - `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=`, and `EMAIL_FROM=` an address on a domain verified in Resend;
> - `CAPTCHA_PROVIDER=turnstile`, `TURNSTILE_SITE_KEY=` and `TURNSTILE_SECRET=`. The Turnstile widget's hostnames must include `pryingeyes.idealsoftwaresolutions.com`.
>
> Then save a copy of `.env` somewhere safe off the server: its keys unlock all the data. Tell me when that's done.

When the owner confirms, check without revealing anything:

```bash
ssh SSH_TARGET 'cd APP_DIR && for k in ADMIN_EMAILS RESEND_API_KEY EMAIL_FROM TURNSTILE_SITE_KEY TURNSTILE_SECRET; do v=$(grep -m1 "^$k=" .env | cut -d= -f2-); [ -n "$v" ] && echo "$k: set" || echo "$k: EMPTY"; done; grep -E "^(EMAIL_PROVIDER|CAPTCHA_PROVIDER)=" .env'
```

If anything is `EMPTY`, or still on a stand-in (`EMAIL_PROVIDER=outbox` or `CAPTCHA_PROVIDER=dev`), ask the owner again.

### 6. Build and start

```bash
ssh SSH_TARGET '
  set -e; cd APP_DIR
  docker compose -f docker-compose.prod.yml up -d --build
  for i in $(seq 1 30); do s=$(docker inspect -f "{{.State.Health.Status}}" pryingeyes-app-1 2>/dev/null); echo "app: $s"; [ "$s" = healthy ] && break; sleep 5; done
  docker compose -f docker-compose.prod.yml ps
  docker compose -f docker-compose.prod.yml logs --tail 30 app | grep -E "PryingEyes|can.t start|Error" || true
  docker compose -f docker-compose.prod.yml logs --tail 10 coturn
  curl -s http://127.0.0.1:$(grep -m1 "^PE_PORT=" .env | cut -d= -f2)/api/health; echo
'
```

- **Expect:** `app` shows `healthy`, the health check returns `{"ok":true}`, and the log contains `PryingEyes ready: production at https://pryingeyes.idealsoftwaresolutions.com; database built in; cache built in`.
- **If the app keeps restarting:** its log starts with `PryingEyes can't start:`, followed by the settings to fix. Report that list to the owner and don't edit provider settings yourself. After the owner fixes them, run `docker compose -f docker-compose.prod.yml up -d`.
- **If the build fails:** report it and stop. A typical cause is the server reaching npm or Docker Hub.

### 7. Add the website to the reverse proxy

Follow the same pattern as the existing subdomains, including their certificate lines. If they use a Cloudflare Origin Certificate that covers `*.idealsoftwaresolutions.com`, reuse it. If nothing existing covers `pryingeyes.idealsoftwaresolutions.com`, stop and ask the owner which certificate files to use.

**(A) nginx on the host.** Create `/etc/nginx/sites-available/pryingeyes.conf`. In the `443` block, copy the `ssl_certificate` lines and `listen` style from an existing subdomain's file. If the existing sites use plain HTTP (Flexible), use a single `listen 80` server with the same `location /` block.

```nginx
map $request_uri $pe_loggable { ~^/t/ 0; ~^/g/ 0; default 1; }   # don't log contact codes or invites

server {
  listen 443 ssl;   # match the existing sites (http2 etc.)
  server_name pryingeyes.idealsoftwaresolutions.com;
  ssl_certificate     <same as the existing subdomains>;
  ssl_certificate_key <same as the existing subdomains>;

  client_max_body_size 64k;
  access_log /var/log/nginx/pryingeyes.access.log combined if=$pe_loggable;

  location / {
    proxy_pass http://127.0.0.1:PE_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 60s;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/pryingeyes.conf /etc/nginx/sites-enabled/pryingeyes.conf
sudo nginx -t && sudo systemctl reload nginx
```

If `nginx -t` fails, remove that symlink, confirm `nginx -t` passes again, and report.

**(B) nginx in a container.**
1. **Connect the app to the proxy's network.** Find the network the proxy container shares with the other apps (`docker inspect <proxy> -f '{{json .NetworkSettings.Networks}}'`). Then create `APP_DIR/docker-compose.override.yml`:
   ```yaml
   services:
     app:
       networks: [default, proxy]
   networks:
     proxy:
       external: true
       name: <that network's name>
   ```
2. **Restart the app with both files:**
   ```bash
   docker compose -f docker-compose.prod.yml -f docker-compose.override.yml up -d
   ```
   From now on, use both `-f` files for every command.
3. **Add a server block** to the proxy's mounted config folder (the same place the other subdomains' files are). Use the server block above, with `proxy_pass http://pryingeyes-app-1:3000;`.
4. **Check and reload:**
   ```bash
   docker exec <proxy> nginx -t && docker exec <proxy> nginx -s reload
   ```

**(C)** Only with the owner's go-ahead from step 2: add the route you proposed then, in the way that proxy's other routes are defined.

### 8. Firewall

Open only the relay's ports, and only if ufw is active:

```bash
ssh SSH_TARGET 'sudo ufw status | grep -q "Status: active" && sudo ufw allow 3478/udp && sudo ufw allow 3478/tcp && sudo ufw allow 49152:65535/udp; sudo ufw status | grep -E "3478|49152" || true'
```

Remind the owner: if the hosting provider has its own firewall or security group, open the same ports there too (3478 udp+tcp, and 49152–65535 udp).

### 9. Nightly backup

```bash
ssh SSH_TARGET "sudo install -d -m 700 /var/backups/pryingeyes && echo '30 2 * * * root cd APP_DIR && docker compose -f docker-compose.prod.yml stop app && docker run --rm -v pryingeyes_pe-data:/data:ro -v /var/backups/pryingeyes:/b alpine tar czf /b/pe-data-\$(date +\%F).tgz -C /data . && cp APP_DIR/.env /var/backups/pryingeyes/env-\$(date +\%F) && chmod 600 /var/backups/pryingeyes/* && docker compose -f docker-compose.prod.yml start app; find /var/backups/pryingeyes -mtime +35 -delete' | sudo tee /etc/cron.d/pryingeyes-backup >/dev/null && sudo chmod 644 /etc/cron.d/pryingeyes-backup"
```

If you added the override file in step 7 (B), put `-f docker-compose.override.yml` after `-f docker-compose.prod.yml` in both compose commands of that cron line.

The website is down for a few seconds each night while the database files are copied. Tell the owner the backups contain the keys, and should be copied off the server, encrypted.

### 10. Verify from this computer and report

```bash
curl -s -o /dev/null -w "privacy page: %{http_code}\n" https://pryingeyes.idealsoftwaresolutions.com/privacy
curl -s https://pryingeyes.idealsoftwaresolutions.com/api/health; echo
ssh SSH_TARGET 'docker ps --format "table {{.Names}}\t{{.Status}}"'
```

Also check that every other subdomain you saw in step 2 still answers (`curl -s -o /dev/null -w "%{http_code}"` each).

Report to the owner:
- what you found in step 2;
- what you changed, file by file;
- the results of the checks;
- anything they still need to do, such as provider firewall ports.

End with this hand-over checklist:

1. Sign up at https://pryingeyes.idealsoftwaresolutions.com with the `ADMIN_EMAILS` address and click the confirmation email: the account becomes an admin.
2. Try a call between a phone on mobile data and a laptop on Wi-Fi. It should reach **Connected**. If it stays on *Connecting securely…*, the relay ports are blocked, or `TURN_HOST` is proxied in Cloudflare.
3. Keep the off-server copy of `.env` safe.

## Updating later (when the owner asks)

```bash
scp NEW_ZIP SSH_TARGET:/tmp/pryingeyes.zip
ssh SSH_TARGET '
  set -e; cd /tmp && rm -rf pe-unpack && mkdir pe-unpack && unzip -q pryingeyes.zip -d pe-unpack
  SRC=$(dirname "$(find pe-unpack -maxdepth 2 -name docker-compose.prod.yml | head -1)")
  rsync -a --exclude .env --exclude docker-compose.override.yml "$SRC"/ APP_DIR/
  rm -rf pe-unpack pryingeyes.zip
  cd APP_DIR && docker compose -f docker-compose.prod.yml $( [ -f docker-compose.override.yml ] && echo -f docker-compose.override.yml ) up -d --build
'
```

Database updates apply when the app starts. Afterwards, check that it's healthy as in step 6.
