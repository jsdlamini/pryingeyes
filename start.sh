#!/usr/bin/env bash
# PryingEyes local runner for Ubuntu. One script, several modes:
#
#   ./start.sh setup      one-time: fresh .env, keys, database, demo data, app packages
#   ./start.sh web        website + background worker            http://localhost:3000
#   ./start.sh app-web    + the phone app in your browser        http://localhost:8081
#   ./start.sh android    + the phone app on an Android emulator (start one in Android Studio first)
#   ./start.sh device     + the phone app on your Android phone over USB
#   ./start.sh go         + Expo Go on your phone (everything except calls)
#   ./start.sh ip         update the call relay after your Wi-Fi address changes
#   ./start.sh check      show which services your .env switches on (email, human check)
#   ./start.sh stop       stop the server, worker and containers
#
# Your keys (Resend, and Cloudflare Turnstile for production) go in .env, in the YOUR SETTINGS
# block at its top. Nothing secret is kept in this script.
# Logs for the server and worker go to var/log/dev-server.log and var/log/dev-jobs.log.
set -euo pipefail

# Find the project folder: the current folder, the script's folder, or a "pryingeyes" folder next
# to the script. So it works from ~/Downloads/pryingeyes or saved one level up as ~/Downloads/start.sh.
is_project() { [ -f "$1/docker-compose.yml" ] && [ -f "$1/.env.example" ] && [ -d "$1/mobile" ]; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/$(basename "${BASH_SOURCE[0]}")"
for d in "$PWD" "$HERE" "$HERE/pryingeyes" "$PWD/pryingeyes"; do
  if is_project "$d"; then cd "$d"; break; fi
done
is_project "$PWD" || { echo "Couldn't find the PryingEyes project. Run this from the project folder (the one with docker-compose.yml)." >&2; exit 1; }

LOG_DIR=var/log
mkdir -p "$LOG_DIR"
say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

lan_ip() { hostname -I 2>/dev/null | awk '{print $1}'; }

set_env() {  # set_env KEY VALUE  (replaces or adds the line; safe for spaces, <, >, & and |)
  local v="$2"
  case "$v" in *[[:space:]\<\>\#]*) v="\"$v\"" ;; esac
  local tmp; tmp=$(mktemp)
  grep -v "^$1=" .env > "$tmp" || true
  printf '%s=%s\n' "$1" "$v" >> "$tmp"
  cat "$tmp" > .env && rm -f "$tmp"
}

# Your own settings (provider keys etc.) live in .env, in the "YOUR SETTINGS" block at its top.
# setup keeps them when it rebuilds .env; everything else in .env is regenerated.
USER_KEYS="APP_ENV APP_URL RP_ID EMAIL_PROVIDER RESEND_API_KEY EMAIL_FROM EMAIL_REPLY_TO CAPTCHA_PROVIDER TURNSTILE_SITE_KEY TURNSTILE_SECRET
  DEFAULT_COUNTRY ANDROID_PACKAGE ANDROID_CERT_SHA256 IOS_BUNDLE_ID IOS_TEAM_ID APP_DOWNLOAD_URL"

env_get() { grep -m1 "^$1=" "${2:-.env}" 2>/dev/null | cut -d= -f2- | sed 's/^"\(.*\)"$/\1/'; }

keep_user_settings() {   # keep_user_settings OLD_FILE  -> copies your settings into the new .env
  local k line
  for k in $USER_KEYS; do
    line=$(grep -m1 "^$k=" "$1" 2>/dev/null) || continue
    local tmp; tmp=$(mktemp)
    # Replace the template's line in place, so the file keeps its layout and comments.
    if grep -q "^$k=" .env; then
      awk -v k="$k" -v l="$line" 'index($0, k"=")==1 && !done { print l; done=1; next } { print }' .env > "$tmp"
    else
      cp .env "$tmp"; printf '%s\n' "$line" >> "$tmp"
    fi
    cat "$tmp" > .env && rm -f "$tmp"
  done
}

# Shows which real services are switched on, and flags settings that won't work.
check_settings() {
  [ -f .env ] || die "No .env yet. Run ./start.sh setup first."
  local ok=1
  local url; url=$(env_get APP_URL); local mode; mode=$(env_get APP_ENV)
  echo "Site:   ${url:-http://localhost:3000} (${mode:-development})"
  if [ "${mode:-development}" != "development" ]; then
    [[ "$url" == https://* ]] || { warn "  APP_URL must start with https:// for $mode"; ok=0; }
    [[ "$url" == *localhost* || "$url" == *127.0.0.1* ]] && { warn "  APP_URL is still a local address; set your public address"; ok=0; }
  fi
  if [ "$(env_get EMAIL_PROVIDER)" = "resend" ]; then
    echo "Email:  Resend, from $(env_get EMAIL_FROM)"
    [[ "$(env_get RESEND_API_KEY)" == re_* ]] || { warn "  RESEND_API_KEY is missing or doesn't start with re_"; ok=0; }
    [[ "$(env_get EMAIL_FROM)" == *resend.dev* ]] && warn "  onboarding@resend.dev only delivers to your own Resend login email. Verify a domain for real use."
  else
    echo "Email:  dev outbox (http://localhost:3000/dev/outbox)"
    [ -n "$(env_get RESEND_API_KEY)" ] && warn "  RESEND_API_KEY is set but EMAIL_PROVIDER=outbox. Set EMAIL_PROVIDER=resend to send real emails."
  fi
  if [ "$(env_get CAPTCHA_PROVIDER)" = "turnstile" ]; then
    echo "Human check: Cloudflare Turnstile"
    { [ -n "$(env_get TURNSTILE_SITE_KEY)" ] && [ -n "$(env_get TURNSTILE_SECRET)" ]; } || { warn "  TURNSTILE_SITE_KEY and TURNSTILE_SECRET are both needed"; ok=0; }
  else
    echo "Human check: built-in checkbox (development only)"
  fi
  [ -n "$(env_get ANDROID_CERT_SHA256)$(env_get IOS_TEAM_ID)" ] && echo "App links: set" || echo "App links: not set (only needed for store builds)"
  echo "Default country: $(env_get DEFAULT_COUNTRY)"
  [ $ok = 1 ] || warn "Fix the lines above in .env (the YOUR SETTINGS block at the top), then restart."
}

point_relay_at_lan() {
  local ip; ip=$(lan_ip)
  [ -n "$ip" ] || die "Couldn't find this computer's network address. Are you connected to Wi-Fi or a network?"
  set_env TURN_URLS "turn:$ip:3478?transport=udp,turn:$ip:3478?transport=tcp"
  # The app's web build may be opened on this computer or from a tablet/phone browser on the Wi-Fi.
  set_env MOBILE_DEV_ORIGINS "http://localhost:8081,http://$ip:8081"
  echo "Call relay set to $ip. Phone app server address: http://$ip:3000"
}

need_setup() {
  [ -f .env ] && grep -q '^TURN_SECRET=.\{20,\}' .env || die "Run ./start.sh setup first."
  [ -d node_modules ] || die "Run ./start.sh setup first (packages missing)."
}

start_services() {
  say "Starting PostgreSQL, Redis and the call relay"
  docker compose up -d --wait
}

PIDS=()
cleanup() {
  [ ${#PIDS[@]} -gt 0 ] || return 0
  say "Stopping the server and worker"
  kill "${PIDS[@]}" 2>/dev/null || true
  wait 2>/dev/null || true
}

start_backend() {   # $1 = "foreground" to follow logs, otherwise run in background
  need_setup
  say "Your settings (.env)"
  check_settings
  start_services
  say "Starting the website and server on http://localhost:3000"
  npm run dev > "$LOG_DIR/dev-server.log" 2>&1 & PIDS+=($!)
  npm run jobs > "$LOG_DIR/dev-jobs.log" 2>&1 & PIDS+=($!)
  trap cleanup EXIT INT TERM
  for _ in $(seq 1 90); do curl -s -o /dev/null http://localhost:3000/privacy && break; sleep 1; done
  curl -s -o /dev/null http://localhost:3000/privacy || { tail -20 "$LOG_DIR/dev-server.log"; die "The server didn't start (log above)."; }
  echo "Website:  http://localhost:3000    Test emails: http://localhost:3000/dev/outbox"
  echo "Phone app server address on a real phone: http://$(lan_ip):3000"
  if [ "${1:-}" = "foreground" ]; then
    echo "Press Ctrl+C to stop."
    tail -n +1 -f "$LOG_DIR/dev-server.log"
  fi
}

# Android builds: find the SDK and Java 17 even if ~/.bashrc isn't set up, and tell Gradle where the SDK is.
android_env() {
  if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "${ANDROID_HOME:-/nonexistent}" ]; then
    for d in "${ANDROID_SDK_ROOT:-}" "$HOME/Android/Sdk" "$HOME/Android/sdk" "$HOME/android-sdk"; do
      if [ -n "$d" ] && [ -d "$d/platform-tools" ]; then export ANDROID_HOME="$d"; break; fi
    done
  fi
  [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME" ] || die "Android SDK not found. Install it with Android Studio (SDK Manager), or set ANDROID_HOME."
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
  export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
  if ! "${JAVA_HOME:-/nonexistent}/bin/java" -version 2>&1 | grep -q 'version "17'; then
    for j in /usr/lib/jvm/java-17-openjdk-amd64 /usr/lib/jvm/java-17-openjdk-arm64 /usr/lib/jvm/temurin-17-jdk-amd64; do
      if [ -x "$j/bin/javac" ]; then export JAVA_HOME="$j"; break; fi
    done
  fi
  "${JAVA_HOME:-/nonexistent}/bin/java" -version 2>&1 | grep -q 'version "17' || die "Java 17 (JDK) not found. Install it: sudo apt install -y openjdk-17-jdk"
  export PATH="$JAVA_HOME/bin:$PATH"
  # The generated Android project reads the SDK location from local.properties.
  if [ -d mobile/android ]; then echo "sdk.dir=$ANDROID_HOME" > mobile/android/local.properties; fi
  echo "Android SDK: $ANDROID_HOME    Java: $JAVA_HOME"
}

mobile_ready() {
  [ -d mobile/node_modules ] || { say "Installing the phone app's packages"; (cd mobile && npm ci); }
}

mode=${1:-help}
case "$mode" in
  setup)
    say "Removing the old database and leftover containers"
    TURN_SECRET=placeholder docker compose down -v --remove-orphans || true

    say "Creating a fresh .env with new keys"
    old=""
    if [ -f .env ]; then old=".env.old.$(date +%Y%m%d-%H%M%S)"; mv .env "$old"; echo "Previous .env kept as $old"; fi
    cp .env.example .env && chmod 600 .env
    # .env.example is set up for the live server; this computer runs locally.
    set_env APP_ENV development; set_env APP_URL http://localhost:3000
    set_env TURN_CONFIG ./docker/turnserver.conf; set_env TURN_CERTS ./docker/no-certs
    # start.sh runs PostgreSQL and Redis in Docker (plain `npm run dev` uses the built-in ones instead).
    set_env DATABASE_URL postgresql://pryingeyes:pryingeyes@127.0.0.1:5433/pryingeyes; set_env REDIS_URL redis://127.0.0.1:6380/0
    [ -n "$old" ] && keep_user_settings "$old" && echo "Kept your settings (email, human check, app links, country) from it."
    npm ci
    npm run keys:generate

    say "Your settings (.env)"
    check_settings
    [ -n "$old" ] || warn "Add your Resend key (and Turnstile keys for production) in the YOUR SETTINGS block at the top of .env, then run ./start.sh check."

    say "Pointing the call relay at this computer"
    point_relay_at_lan

    if command -v ufw >/dev/null && sudo -n true 2>/dev/null && sudo ufw status | grep -q "Status: active"; then
      say "Opening firewall ports for phones (3000, 3478, 49160-49200/udp)"
      sudo ufw allow 3000/tcp >/dev/null && sudo ufw allow 3478 >/dev/null && sudo ufw allow 49160:49200/udp >/dev/null
    elif command -v ufw >/dev/null; then
      warn "If the firewall is on, run: sudo ufw allow 3000/tcp && sudo ufw allow 3478 && sudo ufw allow 49160:49200/udp"
    fi

    start_services
    say "Creating the tables and demo data"
    npm run db:migrate
    npm run seed

    say "Installing the phone app's packages"
    (cd mobile && npm ci)
    say "Setup done. Next: ./start.sh web   (or app-web, android, device, go)"
    ;;

  web)
    start_backend foreground
    ;;

  app-web)
    start_backend; mobile_ready
    point_relay_at_lan >/dev/null
    say "Starting the phone app in your browser on http://localhost:8081"
    warn "Ignore the QR code below: it is for a development build. For a phone or iPad, use ./start.sh go"
    echo "From another device's browser on the Wi-Fi: http://$(lan_ip):8081 (calls need https there, so they won't work)"
    (cd mobile && npx expo start --web --port 8081)
    ;;

  android)
    android_env
    start_backend; mobile_ready
    command -v adb >/dev/null || warn "adb not found: install Android Studio and add its platform-tools to PATH."
    adb devices 2>/dev/null | grep -q "emulator-" || warn "No emulator running: start one in Android Studio > Device Manager."
    say "Building and opening the app on the emulator (first build takes ~10 minutes)"
    (cd mobile && npx expo run:android)
    ;;

  device)
    android_env
    start_backend; mobile_ready
    adb devices 2>/dev/null | grep -v "emulator-" | grep -q "device$" || warn "No phone found: plug it in with USB debugging on, and accept the prompt."
    say "Building and installing the app on your phone"
    echo "On the phone's start screen, tap Change server address and enter http://$(lan_ip):3000"
    (cd mobile && npx expo run:android --device)
    ;;

  go)
    start_backend; mobile_ready
    say "Starting for Expo Go"
    echo "1. Install Expo Go from the App Store / Play Store on your iPad or phone (same Wi-Fi as this computer)."
    echo "2. iPad/iPhone: scan the QR code with the Camera app. Android: scan it inside Expo Go."
    echo "   The app finds the server at http://$(lan_ip):3000 by itself. Calls need a development build."
    (cd mobile && npx expo start --go)
    ;;

  check)
    check_settings
    ;;

  ip)
    [ -f .env ] || die "Run ./start.sh setup first."
    point_relay_at_lan
    echo "Restart the server (./start.sh web or another mode) to use the new address."
    ;;

  stop)
    say "Stopping the server, worker and containers"
    pkill -f "next dev -p 3000" 2>/dev/null || true
    pkill -f "scripts/jobs.ts" 2>/dev/null || true
    docker compose stop
    ;;

  help|-h|--help|*)
    sed -n '2,16p' "$SCRIPT" | sed 's/^# \{0,1\}//'
    ;;
esac
