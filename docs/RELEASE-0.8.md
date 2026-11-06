# PryingEyes 0.8.0: group approvals, and codes shared anywhere

## What changed

**Groups**
- **Anyone can start a group.** Groups show in search by default (*Let people find it in search*); turn that off to make a group reachable only through its invite link.
- **Anyone can ask to join,** from **Find a group** or with an invite link, and can add a short note for the admins. The note passes the contact-details guard, so it can't carry a phone number.
- **Only the creator, or admins they appoint, let people in.**
  - Requests appear on the group page (website) and the group info screen (app), each with **Let in** and **Decline**.
  - Admins get a notification, and the Groups list shows how many people are waiting.
  - The person is notified once they're in.
  - Until then they can't see the group's posts, and their Groups list shows the request as waiting.
- **Declined people may ask again,** and anyone can withdraw a request.

**Contact codes**
- **Shareable in group posts, statuses and private chats.** In a chat, tap the code button next to the message box to include one of your codes. The other person sees **Open contact code**, and tapping it opens your gate with the code filled in. Use it, for example, to let them pass your code on to someone else.
- **Three durations:** *until I switch it off* (reused per group), *24 hours*, or *one person*. A one-person code stops after the first person gets through, and its card then says it has been used.
- **Any code or code link typed into a post or chat is tappable.** It opens the owner's gate with the code filled in.

## Upgrading

```bash
./start.sh setup     # local: fresh database (keeps your .env settings)
```

On a server, rebuild as usual (`docker compose --profile app up -d --build`). Migration `0006` adds join requests and the search setting; existing groups become searchable. Nothing changes in `.env`.

## Tested

- **Server:** 172 tests pass. New tests cover:
  - search, asking to join, approval by the creator or a designated admin, declining, withdrawing;
  - unlisted groups (invite only), and notes that can't carry numbers;
  - one-person codes being used up, 24-hour codes on statuses, and a code shared in a chat opening the gate for a third person.
- **Website end to end:** 16 tests pass. New:
  - an invite request approved by the creator;
  - finding a group, asking, being approved, then a code shared in a chat being tapped through to the gate.
- **App end to end:** 3 tests pass. The app asks to join from an invite link, and the creator approves on the website.
