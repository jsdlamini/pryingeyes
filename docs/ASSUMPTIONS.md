# Assumptions and decisions

Each entry records a point the prompt left open, or a deliberate deviation from it. Entries marked **⚠ review** change the security model, a stack choice or the user experience, so a human should confirm them.

## Process

1. **Milestone STOP points collapsed — ⚠ review.** The product owner asked for the whole system in one pass ("implement the system… return a zip"). That request was treated as approval to run M0–M7 straight through. The six-line STOP reports are collected in `FINAL_REPORT.md`.

## Stack

2. **Drizzle ORM instead of Prisma — ⚠ review.** Prisma's migration engine is a native binary downloaded from `binaries.prisma.sh`, which the build environment could not reach, so no Prisma migration could be tested. Drizzle is pure TypeScript with plain SQL migrations (`drizzle/`) on the same PostgreSQL. Switching back later means porting `src/db/schema.ts`; all queries live in `src/lib`.
3. **`APP_ENV` separate from `NODE_ENV`.** `next start` always sets `NODE_ENV=production`, including on a desktop test run. `APP_ENV` (development, staging or production) decides whether stand-ins are allowed. Any value other than `development` refuses to start with the dev human check, email outbox or outbox email, or without https.
4. **Chat uses polling (3 s) rather than WebSockets.** Next.js route handlers don't host WebSockets. Polling works through any proxy and keeps the server stateless. The message API is transport-independent, so SSE or WebSockets can be added later.

## Security model

5. **CAPTCHA before the token lookup.** Rule 7 lists the token status check first. If the CAPTCHA ran after the lookup, a "CAPTCHA failed" reply would reveal that the code exists, so it runs first. The order is: lockout → in-flight cap → IP budget → caller budget → CAPTCHA → token status → standing → per-token budgets.
6. **Per-caller in-flight cap (2).** Not in the prompt. Without it, a burst of 50 parallel guesses got about 10 evaluated before the five-failure lockout landed (99.90%, failing the > 99.9% bar). With it, exactly 5 are evaluated (99.95%).
7. **Codes are shown once and can't be retrieved — ⚠ review (UX).** Rule 4 says to store only the HMAC, so owners must copy or download the link, QR and short code when they create a token. A lost code is replaced by **Rotate**, which kills the old one. The alternative would be storing codes encrypted under the owner's key, as numbers are. That's a security-model change, so it was not done.
8. **The token label is shown to callers** once they pass the gate and in the watermark. The field is captioned so owners know this.
9. **Region is country-level.** It comes from an edge header (`CF-IPCountry` etc.) when present, otherwise it is left blank. No GeoIP database is bundled.
10. **Owner prerequisites.** These are a verified account, 18+ confirmation, at least one second factor, and a session that used it. Phone-only accounts can become owners by adding a passkey or authenticator app; a password is not required.
11. **Panic needs no step-up.** Re-issuing, resuming or rotating tokens afterwards requires a second-factor check *after* the panic time.
12. **Step-up windows.** Sensitive owner actions need a second factor within the last 10 minutes. Data export, erasure and admin actions allow 15 minutes. Removing a number allows 30.
13. **Up to 5 protected numbers per account** (not specified), plus the rule-5 cap of 10 live tokens per number.
14. **Alerts go in-app and by email.** PryingEyes sends no text messages (removed in 0.7.0).
15. **No phone-network calls.** Calls happen only in the app, over data (0.6.0 removed the optional phone-network relay, its provider settings and its minute caps).
16. **The dev outbox stores masked numbers only** (`····56`), so even development databases pass the plaintext scan.
17. **Moderation data key.** Report details are encrypted under a key derived from `SECRETS_HMAC_KEY`, not under a person's key, so moderators can read them after either party deletes their account.
18. **Conversation keys are derived from the owner's data key.** Erasing either party deletes the conversation for both, because the conversation is personal data of both.
19. **Audit retention nulls payloads, never rows.** Each link hashes the payload's hash, so the chain still verifies after erasure or retention. The database trigger allows only `payload → NULL` updates.
20. **No phone-network services.** The voice webhook and the SMS provider were removed (0.6.0 and 0.7.0); email (Resend) is the only outside messaging service.
21. **Anchors are daily, for completed days only.** They're written to `audit_anchors` and to a write-once file (`var/anchors/YYYY-MM-DD.anchor`, mode 0444, created exclusively). In production, point `AUDIT_ANCHOR_DIR` at storage with object lock or `chattr +a`.

22. **Handles are generated, not chosen, by default.** Sign-up pre-fills a free random handle (adjective_noun_NN, e.g. `quiet_heron_42`), never derived from the email, name or phone, because handles are shown to everyone you contact. People can keep it, ask for another, or type their own (checked live). If a typed handle is taken, the API returns `handle_taken` with a fresh `suggestion`. If the field is left empty, the server generates one.

23. **Email goes through Resend.** It uses Resend's REST API directly (no SDK, no SMTP), with one idempotency key per message that is reused across retries. Only 429 and 5xx responses are retried, up to 3 attempts. A plain-text body is sent with a minimal HTML copy. Logs carry the Resend email id and category, never addresses. In development, emails are captured at `/dev/outbox` unless `EMAIL_PROVIDER=resend`; then they're sent *and* captured. If the confirmation email can't be sent, sign-up returns `email_unavailable` (503), and signing up again replaces the unconfirmed attempt.

24. **Phone numbers are entered as country + national number.** Every phone field has a country picker (Southern African countries first, the last choice remembered in the browser) and the API takes `phone` plus an ISO `country`. A number starting with `+` or `00` overrides the selected country, and pasting one switches the picker automatically. If `country` is omitted, `DEFAULT_COUNTRY` is used, so older clients keep working.

25. **Chat and call alerts never carry content and are throttled.** A new chat notifies the owner in the app and by email. Later messages notify the other side at most once every 15 minutes per conversation (Redis `SET NX EX 900`), never with message text. Only the caller can start a relay call. From a chat, they can do so while their gate request is valid and still allows relay; otherwise they open the link again.

26. **Calls go over data inside the app, through our own relay.** Calls use WebRTC audio, forced through a self-hosted coturn relay. The server hands out only `iceTransportPolicy: "relay"`, and it also strips host and server-reflexive candidates from signalling, so neither person ever learns the other's IP address. TURN can't decrypt the DTLS-SRTP media, so 1:1 calls are end-to-end encrypted. The database stores call metadata only (who, when, length, outcome). Offers, answers and ICE candidates pass through Redis lists that are deleted on read and expire after 10 minutes.

27. **A closed browser can't ring.** The open app polls `/api/calls/incoming` every 3 seconds and rings on any page. If nobody answers within `CALL_RING_SECONDS` (45), the call becomes **missed**. The owner gets an in-app and email notification linking to a chat with the caller (opened quietly if needed), and the chat timeline shows the call. Native apps will plug a VoIP push (APNs PushKit / FCM) into `notifyIncoming()` in `src/lib/calls.ts`; the rest of the call API and state machine stays the same (see the documentation's native-app contract).

28. **One call at a time, and only callers start calls.** A second caller gets *busy*, and the owner gets a missed-call notice. Each caller can start at most 10 calls an hour. A call ends when either side hangs up, or when either side stops polling for 30 seconds (closed tab, lost signal). Calls last at most 2 hours.

29. **Phone-network calls were removed in 0.6.0.** In-app calling needs only the TURN relay. Migration `0005_drop_phone_relay` drops the old call table.

30. **The phone app uses bearer sessions, not cookies.**
    - A sign-in request carrying `X-PE-Client: mobile` gets its session token in the response body instead of a cookie.
    - The app stores the token in the phone's keychain or keystore and sends it as `Authorization: Bearer`.
    - The session is bound to the install's `X-PE-Device` value, the same way web sessions are bound to the browser's user-agent.
    - Requests from the app skip the `Origin` check only when they carry no cookies. Without an ambient credential there is nothing for a cross-site request to forge, and browsers can't add the header cross-site without a preflight that production never allows.
    - `MOBILE_DEV_ORIGINS` (development only) lets the app's web build call the API, for automated tests.

31. **The app speaks the same call protocol as the website.**
    - Native WebRTC (react-native-webrtc) needs a development build. In Expo Go the app says calls are unavailable instead of crashing.
    - Incoming calls ring while the app is open (a banner plus vibration). A closed app gets a missed call, exactly like the website. VoIP push is the next step (`notifyIncoming()` in `src/lib/calls.ts`).

32. **Groups and statuses never carry contact details as text.**
    - The guard (`src/lib/guard.ts`) rejects phone numbers, email addresses and messaging links (wa.me, t.me, tel:, mailto: …) in group names, descriptions, posts and statuses.
    - It sees through the usual disguises: spaced, dotted or dashed digits, digits written as words ("seven six one…", "double seven"), full-width digits, O for 0 and l for 1, and "name at gmail dot com". Dates, times and prices stay allowed.
    - It is strict on purpose. A false positive costs a rewording; a false negative publishes someone's number. Rejections are audited (`post.rejected_contact`) without the text.
    - Posts are text only. Images are not supported, so a photo of a number can't be posted either.

33. **Contact codes on posts are per place.** Attaching a code mints a token labelled "Group: <name>" (or "Status updates"), from the author's protected number, at the tier they pick (default Verified). Later posts in the same group reuse it while it is active. Revoking it on the dashboard switches it off in that group only; the post then shows "switched off". Attaching needs the owner checks (two-step sign-in), the same as creating any code.

34. **Who sees what.** Group posts: members only. Statuses: for 24 hours, to people who share at least one group with the author. Blocking (from a report or a chat) hides posts both ways. Members see handles, never numbers. Invite codes are 60-bit, stored as an HMAC plus a copy encrypted for the admin who issued them; resetting one kills the old link. The last admin leaving hands admin to the longest-standing member; the last member leaving deletes the group.

35. **Tapping a code fills it in.** Codes and invites are links (`https://<host>/t/<code>`, `/g/<invite>`). With App Links (Android) and Universal Links (iOS) set up, the phone opens the app on the gate or join screen with the code already in place. Without the app, the website does the same. The app also understands `pryingeyes://t/<code>`, and has a one-tap *Paste* button for codes copied from elsewhere.

36. **Phone numbers are optional (0.6.0).** A code can be *app-only* (`tokens.number_id` is null). Callers then get only *Send a message* and *Call in the app*, and the owner's "show my number once" approval becomes a plain approval. Anyone verified and 18+ can create app-only codes, take requests and see their activity without two-step sign-in, because no number is at risk. Two-step sign-in is still required to add a number, to create or renew a code that can show one, and to approve showing it. Groups always attach app-only codes. The verified phone on each account stays: it is the anti-abuse check (one person, one account) and is never shown.

37. **Email only, no text messages (0.7.0).** Accounts sign up with email and password (plus optional passkeys and authenticator app). Tier 2 and 3 callers confirm a 6-digit code sent to their verified email. Sign-up confirmation links carry the code or invite the person was opening (`next`, local paths only), so they return to it after signing in. The sign-up limit per network address is a setting (`RL_SIGNUP_PER_IP_HOUR`, default 30) because campus, office and mobile networks put many people behind one address. Accounts that were created by phone only (before 0.7.0) can no longer sign in; in development, run `./start.sh setup` for a fresh database.

38. **Joining a group needs an admin's approval (0.8.0).** Anyone can create a group. Anyone can ask to join: a *listed* group (the default) shows in search; an *unlisted* one only through its invite link. Every request, by search or invite, waits for the group's creator or an admin they appointed, who sees the handle and an optional note (which passes the contact-details guard). Admins are notified of requests; the person is notified when let in. A declined person may ask again; requests can be withdrawn.

39. **Codes can be shared anywhere, for as long as you choose (0.8.0).** A code attached to a group post, a status or a private chat message can last until switched off, for 24 hours, or for one person only. Standing codes are reused per place; 24-hour and one-person codes are always new. A code shared in a chat arrives as a link that both apps show as a tappable *Open contact code* chip; any code or code link typed into a post or chat is tappable too. Tapping one opens the owner's gate with the code filled in. A used one-person code shows "already used" instead.

## Phase 2 seams (built as interfaces only)

- Tier 4 exists in the schema and UI as *Coming soon* and cannot be selected (API returns `tier_unavailable`).
- `KeyProvider` interface with `LocalKeyProvider`. A cloud KMS implements `wrap` and `unwrap`; break-glass `rewrap_keys` re-wraps every data key after KEK rotation.
- Chat encryption is isolated in `src/lib/chat.ts`, which is where a Double Ratchet client-side scheme would plug in.
- Decoy tokens, trusted-contact escalation, breach monitoring, virtual numbers, the partner API, the PWA and native apps are not built (out of scope).
