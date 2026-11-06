# Deploying PryingEyes as a subdomain on a shared nginx server

Live address: **https://pryingeyes.idealsoftwaresolutions.com**

This guide is for an Ubuntu server that already serves other sites through nginx. PryingEyes becomes one more site and doesn't touch the others. It's an ordinary Next.js app started with `npm start`. Its database and cache are built in, so there's no Docker and no separate PostgreSQL or Redis to install. The only extra service is the call relay (coturn), which comes from Ubuntu's own packages.

| Part | Runs as |
|---|---|
| Website, database (built in), cache (built in), background jobs | one Node process, `pryingeyes.service`, on `127.0.0.1:3100` |
| Call relay | `coturn`, Ubuntu package, ports 3478 and 5349 |
| HTTPS | your existing nginx, one new site file, one Let's Encrypt certificate |

`DEPLOY.md` has the background on keys, audit anchors and monitoring.

## 0. What you need first

- **DNS:** an `A` record for `pryingeyes.idealsoftwaresolutions.com` pointing at the server's public IP. Add `AAAA` too if you use IPv6.
- **Node.js 22**, installed system-wide so the service can find it:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
  node -v    # v22.x
  ```
- **nginx and certbot** (you already have them), plus coturn: `sudo apt-get install -y coturn`.
- **Production accounts.** The website won't start in production with development stand-ins:
  - **Cloudflare Turnstile:** a widget whose hostnames include `pryingeyes.idealsoftwaresolutions.com`. Note its site key and secret.
  - **Resend:** a sending domain you've verified (SPF and DKIM).
- **Firewall:** open the call relay's ports, `3478/udp+tcp`, `5349/tcp` and `49152-65535/udp`. Ports 80 and 443 are already open for your other sites.

## 1. Get the code and the settings

```bash
sudo useradd --system --create-home --home-dir /opt/pryingeyes --shell /usr/sbin/nologin pryingeyes
sudo -u pryingeyes -s       # work as that user from here on
cd /opt/pryingeyes          # unzip or git clone the project here
npm ci
npm run build               # the first build also creates .env from .env.example, with fresh keys
```

`.env` is already set up for this server: `APP_ENV=production`, `APP_URL=https://pryingeyes.idealsoftwaresolutions.com`, the built-in database and cache, and the call relay on the same host. Open it and fill in the **YOUR SETTINGS** block at the top:

```ini
ADMIN_EMAILS=you@idealsoftwaresolutions.com     # becomes admin once you confirm this email

EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM=PryingEyes <no-reply@idealsoftwaresolutions.com>   # on a domain verified in Resend

CAPTCHA_PROVIDER=turnstile
TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET=...
```

Then check it:

```bash
chmod 600 .env
grep '^TURN_SECRET=' .env          # you'll need this value for the call relay in §2
exit                               # back to your own user
```

**Back up `.env` now, somewhere off the server.** Its keys unlock all the data. A new `.env` can't read data written with the old one, so the website refuses to start rather than invent new keys over existing data.

## 2. The call relay (coturn)

The project's production settings for the relay are already filled in for this host:

```bash
sudo cp /opt/pryingeyes/docker/turnserver.prod.conf /etc/turnserver.conf
echo "static-auth-secret=<TURN_SECRET from .env>" | sudo tee -a /etc/turnserver.conf
sudo chmod 640 /etc/turnserver.conf && sudo chown root:turnserver /etc/turnserver.conf
```

If the server is behind NAT, uncomment `external-ip=` in `/etc/turnserver.conf` and set it to `<public-ip>/<private-ip>`.

coturn needs to read the TLS certificate. You'll get it in §3; this step gives coturn a copy now and again after every renewal:

```bash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/pryingeyes-coturn.sh >/dev/null <<'EOF'
#!/bin/sh
D=/etc/letsencrypt/live/pryingeyes.idealsoftwaresolutions.com
install -d -o turnserver -g turnserver -m 750 /etc/coturn/certs
install -o turnserver -g turnserver -m 640 "$D/fullchain.pem" "$D/privkey.pem" /etc/coturn/certs/
systemctl restart coturn
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/pryingeyes-coturn.sh
sudo sed -i 's#^cert=.*#cert=/etc/coturn/certs/fullchain.pem#; s#^pkey=.*#pkey=/etc/coturn/certs/privkey.pem#' /etc/turnserver.conf
sudo sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null || true
```

You'll start coturn at the end of §3, once the certificate exists.

## 3. Add the nginx site and get the certificate

Create `/etc/nginx/sites-available/pryingeyes.conf`. The variable names start with `pe_`, so they can't clash with your other sites' configuration.

```nginx
map $request_uri $pe_loggable { ~^/t/ 0; ~^/g/ 0; default 1; }   # don't log codes or invites

server {
  listen 80;
  listen [::]:80;
  server_name pryingeyes.idealsoftwaresolutions.com;
  location /.well-known/acme-challenge/ { root /var/www/html; }
  location / { return 301 https://$host$request_uri; }
}

server {
  listen 443 ssl http2;          # nginx 1.25+ prefers "http2 on;" but this form works on Ubuntu's 1.24 too
  listen [::]:443 ssl http2;
  server_name pryingeyes.idealsoftwaresolutions.com;

  ssl_certificate     /etc/letsencrypt/live/pryingeyes.idealsoftwaresolutions.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/pryingeyes.idealsoftwaresolutions.com/privkey.pem;

  client_max_body_size 64k;
  access_log /var/log/nginx/pryingeyes.access.log combined if=$pe_loggable;
  error_log  /var/log/nginx/pryingeyes.error.log;

  location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 60s;
  }
}
```

To issue the certificate, comment out the `443` block first, so nginx can start without a certificate that doesn't exist yet:

```bash
sudo ln -s /etc/nginx/sites-available/pryingeyes.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx          # nginx -t checks ALL sites before reloading
sudo certbot certonly --webroot -w /var/www/html -d pryingeyes.idealsoftwaresolutions.com
# uncomment the 443 block, then:
sudo nginx -t && sudo systemctl reload nginx
sudo /etc/letsencrypt/renewal-hooks/deploy/pryingeyes-coturn.sh   # give coturn its first copy, then start it
sudo systemctl enable --now coturn
```

A reload is graceful: your other subdomains keep serving throughout.

## 4. Run the website as a service

Create `/etc/systemd/system/pryingeyes.service`:

```ini
[Unit]
Description=PryingEyes website
After=network.target

[Service]
User=pryingeyes
WorkingDirectory=/opt/pryingeyes
# Listens only on this machine; nginx is the way in.
ExecStart=/usr/bin/npm start -- -p 3100 -H 127.0.0.1
Restart=always
RestartSec=5
# One process: it holds the built-in database open.
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pryingeyes
journalctl -u pryingeyes -n 30 --no-pager
```

When it starts, the website:
- checks the settings;
- creates and updates its database;
- makes any already-confirmed `ADMIN_EMAILS` accounts admins;
- starts its background jobs (expiring codes and messages, missed calls).

The log should end with:

```
PryingEyes ready: production at https://pryingeyes.idealsoftwaresolutions.com; database built in; cache built in
```

If a setting is missing it stops instead, listing what to fix, for example `CAPTCHA_PROVIDER=dev is not allowed in production`. Fix `.env`, then `sudo systemctl restart pryingeyes`.

**First admin:** sign up on the site with the address you put in `ADMIN_EMAILS`. Once you click the confirmation link, your account is an admin.

## 5. Backups

Back up **`/opt/pryingeyes/.env` and `/opt/pryingeyes/var/` together**. `var/data` holds the database and `var/anchors` the audit anchors; the keys in `.env` unlock them.

The built-in database is a folder of files, so copy it while the website is stopped. The website is down for a few seconds:

```bash
# /etc/cron.d/pryingeyes-backup: every night at 02:30
30 2 * * * root systemctl stop pryingeyes && tar czf /var/backups/pryingeyes-$(date +\%F).tgz -C /opt/pryingeyes .env var && systemctl start pryingeyes && find /var/backups -name 'pryingeyes-*.tgz' -mtime +35 -delete
```

Keep backups encrypted and off the server, for 35 days at most (the retention policy). To restore, stop the service, unpack the archive into `/opt/pryingeyes`, and start the service again.

**Outgrowing the built-in database.** It serves one website process. For zero-downtime backups, more traffic, or several app servers, install PostgreSQL and Redis and set `DATABASE_URL` and `REDIS_URL` in `.env`. Nothing else changes: the website creates the tables itself on the next start. Moving existing data across is a one-off export and import; plan it before you have many users.

## 6. Point the phone app at it

The app's store and test builds (`preview` and `production` in `mobile/eas.json`) already use `https://pryingeyes.idealsoftwaresolutions.com`:

```bash
cd mobile
npx eas-cli@latest build --profile preview --platform android
```

Those builds switch off plain-HTTP access. People can still change the server under **Server settings**.

## 7. Make code and invite links open the app

A contact code in a group is a link: `https://pryingeyes.idealsoftwaresolutions.com/t/<code>`. An invite is `https://pryingeyes.idealsoftwaresolutions.com/g/<invite>`. On a phone with the app installed, tapping one should open the app with the code already filled in. Without the app, the website does the same thing, with an *Open in the app* button.

1. **The app builds already carry the address** (§6). That switches on the Android intent filters (`autoVerify`) and the iOS associated domain `applinks:pryingeyes.idealsoftwaresolutions.com`.
2. **Tell the server which app is allowed to open its links.** In `.env`:
   - `ANDROID_CERT_SHA256`: the SHA-256 fingerprint of the signing certificate. It's in Play Console → *App integrity*, or shown by `npx eas-cli credentials` for EAS builds. For sideloaded test APKs, add the upload key's fingerprint too, comma-separated.
   - `IOS_TEAM_ID`: your Apple team ID. `IOS_BUNDLE_ID` defaults to `com.pryingeyes.app`.
   - `APP_DOWNLOAD_URL` (optional): where the website's *Get the app* link points.

   Then restart the website: `sudo systemctl restart pryingeyes`.
3. **Check the files.** Both must return JSON with status 200 and no redirect:
   ```bash
   curl -s https://pryingeyes.idealsoftwaresolutions.com/.well-known/assetlinks.json
   curl -s https://pryingeyes.idealsoftwaresolutions.com/.well-known/apple-app-site-association
   ```
4. **Check on a phone.**
   - **Android:** run `adb shell pm get-app-links com.pryingeyes.app`; the domain should show `verified`.
   - **iOS:** long-press a code link in Notes; *Open in PryingEyes* should appear.

The custom scheme `pryingeyes://t/<code>` always works once the app is installed, with no server setup.

## 8. Updating later

```bash
sudo -u pryingeyes -s
cd /opt/pryingeyes            # replace the code (git pull or unzip), keeping .env and var/
npm ci && npm run build
exit
sudo systemctl restart pryingeyes   # database updates are applied on start
```

## 9. Scripts and the built-in database

Only one process may open the built-in database: the website. Scripts that use it, such as `npm run seed`, `npm run admin:create` and `npm run audit:verify`, refuse while the website is running. They say so plainly; nothing is damaged. Stop the service first (`sudo systemctl stop pryingeyes`), run the script as the `pryingeyes` user, then start it again. With an external `DATABASE_URL`, scripts run alongside the website.

## Alternative: Docker

If your other sites run in Docker, use `docker-compose.prod.yml` instead of §1, §2 and §4. It runs two containers: the website, with its built-in database in a volume, and the call relay. See **`docs/DEPLOY-DOCKER.md`**, and `docs/DEPLOY-AGENT-INSTRUCTIONS.md` for step-by-step agent instructions.

## Checklist

- [ ] `https://pryingeyes.idealsoftwaresolutions.com` loads, and your other subdomains still do.
- [ ] `journalctl -u pryingeyes` shows `PryingEyes ready: production …`.
- [ ] The sign-up confirmation email arrives (Resend), and your `ADMIN_EMAILS` account shows **Admin** after confirming.
- [ ] A Tier 2 gate code email arrives.
- [ ] A call between a phone on mobile data and a laptop on Wi‑Fi reaches **Connected**. If it stays on *Connecting securely…*, check `systemctl status coturn` and the ports 3478, 5349 and 49152–65535/udp.
- [ ] Posting a phone number in a group is refused; a post with an attached contact code shows a tappable code.
- [ ] Tapping a code link on a phone with the app opens the app's gate with the code filled in (§7).
- [ ] The nightly backup runs (§5), and you've tried a restore once.
