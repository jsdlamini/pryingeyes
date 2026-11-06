# PryingEyes 0.5.0: safe groups and statuses

## What's new

- **Groups.** Start a group, share its invite link, and post. Members see each other by handle only.
- **Statuses.** Posts that last 24 hours, seen only by people who share a group with you.
- **No contact details as text.** Phone numbers, email addresses and messaging links are refused in group names, descriptions, posts and statuses. Disguised forms are refused too: `76 12 34 56`, "seven six one two…", `name at gmail dot com`, wa.me links.
- **Contact codes instead.** **Attach my contact code** adds a tappable code to a post. Each group gets its own code, which you can switch off from the dashboard.
- **Tap, don't paste.** Tapping a code opens the gate with the code already filled in:
  - in the app, if it's installed (App Links, Universal Links, or `pryingeyes://`);
  - otherwise on the website, which also offers **Open in the app** on phones.

  Invite links work the same way. The app also has a one-tap **Paste** button for codes copied from elsewhere.
- **Reports.** Reported posts go to moderators (who now have **Remove post**) and to the group admins. Reporting can also block the author.

## Upgrading a running server

```bash
cd /opt/pryingeyes
# replace the code, keep .env
docker compose --profile app up -d --build      # applies migration 0003_social on start
```

Then add these to `.env` once you have app builds. Until then, everything works except links opening the app directly; they open the website instead.

```ini
ANDROID_CERT_SHA256=AA:BB:...    # signing-cert SHA-256 (Play Console → App integrity, or `npx eas-cli credentials`)
IOS_TEAM_ID=ABCDE12345           # Apple team ID
APP_DOWNLOAD_URL=                # optional: where "Get the app" points
```

In the nginx site, add `~^/g/ 0;` to the `$pe_loggable` map so that invite links aren't logged:

```nginx
map $request_uri $pe_loggable { ~^/t/ 0; ~^/g/ 0; ~^/api/relay/webhook 0; default 1; }
```

Check the app-link files:

```bash
curl -s https://pryingeyes.example.com/.well-known/assetlinks.json
curl -s https://pryingeyes.example.com/.well-known/apple-app-site-association
```

Build the app with the server's address. This also turns on the link handling:

```bash
cd mobile
EXPO_PUBLIC_API_URL=https://pryingeyes.example.com npx eas-cli@latest build --profile preview --platform android
adb shell pm get-app-links com.pryingeyes.app    # after installing: the domain should say "verified"
```

The full walkthrough is in `docs/DEPLOY-SUBDOMAIN.md` §6.

## Trying it locally

```bash
./start.sh web              # website on :3000; open /groups
./start.sh android          # app on the emulator; open the Groups tab
# open an invite in the emulator's app without App Links:
adb shell am start -a android.intent.action.VIEW -d "pryingeyes://g/<invite-code>"
```

## Tested

- **Server:** 168 tests pass, including 25 for the guard and 10 for groups and statuses.
- **Website end to end:** 14 tests pass, including a full group journey:
  1. A number is refused.
  2. A post with a code is accepted.
  3. A member joins by invite and signs up by text.
  4. The member taps the code, the gate opens filled in, and a chat starts.
  5. An accessibility check passes.
- **App end to end:** 3 tests pass. The new one:
  1. joins from an invite link, signing up on the way;
  2. sees a number refused;
  3. taps a code to reach the gate with the code filled in, and starts a chat.
- **App:** 12 unit tests pass, including the app-link config. Typecheck, lint, Android and iOS bundles and the plaintext-at-rest scan all pass.
