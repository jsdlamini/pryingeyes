# Deployment guide

Sharing a server with other sites behind nginx? See [`DEPLOY-SUBDOMAIN.md`](DEPLOY-SUBDOMAIN.md) for the step-by-step subdomain setup.

This produces configuration only. Nothing has been deployed. Follow these steps for a single-server staging deployment, then repeat for production once `LAUNCH_CHECKLIST.md` is complete.

## 1. Server

- Ubuntu 24.04 LTS, 2 vCPU / 4 GB RAM is plenty for launch.
- Install Docker, nginx and certbot. Open only 22 (restricted), 80 and 443.
- Create a non-root deploy user.

## 2. Configuration

```bash
git clone <your repo> /opt/pryingeyes && cd /opt/pryingeyes
cp .env.example .env && npm ci && npm run keys:generate
```

Edit `.env`:

| Setting | Staging / production value |
|---|---|
| `APP_ENV` | `staging` or `production` (refuses dev stand-ins and plain http) |
| `APP_URL` (top of `.env`, *Site address*) | `https://pryingeyes.example`. `RP_ID` can stay empty: it follows `APP_URL`'s host |
| `DATABASE_URL`, `REDIS_URL` | Managed PostgreSQL 16 and Redis 7, both with TLS and private networking |
| `CAPTCHA_PROVIDER`, `TURNSTILE_*` | `turnstile` with your Cloudflare keys |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | `resend`; an API key with sending access; a sender on a domain verified in Resend (SPF + DKIM; add DMARC) |
| `TRUST_PROXY_HOPS` | `1` behind nginx; add 1 for each proxy in front of it (e.g. Cloudflare → nginx = 2) |
| `AUDIT_ANCHOR_DIR` | A directory on write-once storage (see §5) |

Keep `.env` out of git (mode 0600). Move the secrets into your secrets manager when you have one; the app reads plain environment variables.

**KMS:** `LocalKeyProvider` keeps the KEK in `.env`. For production, implement `KeyProvider` in `src/lib/keys.ts` against AWS KMS, GCP KMS or Azure Key Vault. Wrap = Encrypt and unwrap = Decrypt, with the context string as encryption context.

## 3. Run

```bash
docker compose --profile app up -d --build   # app + retention worker (uses DATABASE_URL/REDIS_URL from .env if you remove the compose overrides)
```

or with systemd: `npm ci && npm run build && npm run db:migrate`, then two services running `npm start` and `npm run jobs`.

## 4. nginx (TLS termination)

```nginx
server {
  listen 443 ssl http2;
  server_name pryingeyes.example;
  ssl_certificate     /etc/letsencrypt/live/pryingeyes.example/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/pryingeyes.example/privkey.pem;
  ssl_protocols TLSv1.3;
  client_max_body_size 64k;
  access_log /var/log/nginx/pryingeyes.log combined if=$loggable;   # see note
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
map $request_uri $loggable { ~^/t/ 0; ~^/g/ 0; default 1; }   # don't log codes or invites
server { listen 80; server_name pryingeyes.example; return 301 https://$host$request_uri; }
```

Put a WAF in front (Cloudflare or similar) and enable its bot and rate rules for `/api/gate/*` and `/api/auth/*`.

## 5. Audit anchors (write-once)

Point `AUDIT_ANCHOR_DIR` at storage that can't be rewritten. Options:

- An S3 bucket with Object Lock in compliance mode, mounted or synced daily.
- A local directory with `chattr +a` (append-only).

Run `npm run audit:verify` daily from cron and alert on failure.

## 6. Backups and erasure

- Nightly encrypted PostgreSQL backups, kept for **35 days at most**. Erasure reaches backups by rotation; deleted data keys make old ciphertext unreadable.
- Test a restore every quarter (RPO 5 min with WAL archiving; RTO 4 h).
- Redis holds only counters and short-lived challenges, so it needs no backup.

## 7. TURN relay for in-app calls (coturn)

In-app calls are WebRTC audio between the two people's browsers, always relayed through your own TURN server so neither side learns the other's IP address. TURN only forwards encrypted DTLS-SRTP packets, so it cannot listen to calls. Phone numbers are never involved.

1. **Host.** A small VM with a public IP is enough. Each call uses about 50 kbit/s each way, so 100 simultaneous calls need roughly 10 Mbit/s. Use a DNS name such as `turn.example.com` and get a Let's Encrypt certificate for it.
2. **Install.** Use `apt install coturn`, or the `coturn/coturn:4.18` image with `--network=host`. Start from `docker/turnserver.prod.conf`: set `realm`, `server-name`, `cert` and `pkey`, plus `external-ip` if the VM is behind 1:1 NAT. Pass the secret with `--static-auth-secret="$TURN_SECRET"`, using the same value as the app's `TURN_SECRET`.
3. **Firewall.** Open 3478/udp, 3478/tcp, 5349/tcp (TURN over TLS, for networks that block UDP) and the relay range 49152–65535/udp.
4. **App settings:**
   ```
   TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
   TURN_SECRET=<same as coturn>
   CALL_RELAY_ONLY=true
   CALL_RING_SECONDS=45
   ```
   The app refuses to start in staging or production without a public TURN URL, a 32+ character secret and relay-only mode.
5. **Abuse limits.** The template denies relaying to private address ranges (so the relay can't be used to reach your internal network), caps allocations per credential and in total, and keeps peer addresses out of logs. Credentials are issued per signed-in user and expire after an hour.
6. **Missed calls.** Run the `jobs` worker (`npm run jobs`). Besides housekeeping, it checks every 10 seconds for rings nobody answered and sends the missed-call notification even when nobody has the app open.
7. **Check.** Call between a phone on mobile data and a laptop on another network. Both screens should reach *Connected*. If calls stay on *Connecting securely…* and then fail, the relay ports are blocked.

Calls are in the app only. There are no phone-network calls, so there is no voice provider to set up.

## 8. Resend (email)

1. In Resend, add and verify your sending domain (Domains → Add domain). Add the SPF and DKIM records it shows to your DNS, and a DMARC record (`v=DMARC1; p=quarantine; rua=mailto:you@yourdomain.com`).
2. Create an API key with **sending access** only, restricted to that domain if you can.
3. Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=re_...` and `EMAIL_FROM="PryingEyes <no-reply@yourdomain.com>"`. The app refuses to start in staging or production with the `onboarding@resend.dev` test sender.
4. Run `npm run email:test -- --to=you@yourdomain.com`, then check https://resend.com/emails. Resend's `delivered@resend.dev` and `bounced@resend.dev` test inboxes simulate outcomes.
5. Emails are tagged by category (`verification`, `one_time_code`, `consent_request`, `token_frozen`, ...) so you can filter them in Resend. The app retries Resend's 429 and 5xx responses under one idempotency key, so a retry never sends twice.

## 9. First admin

Sign up normally, then on the server run `npm run admin:create -- --handle=<you> --role=admin`. Repeat for a second admin. From then on, use the in-app dual-control flow.

## 10. Monitoring

Alert on:
- 5xx rate
- p95 of `/api/gate/start` above 300 ms
- `npm run audit:verify` failures
- retention-worker failures
- Resend bounces and complaints (Resend dashboard)
- moderation reports older than 60 minutes
