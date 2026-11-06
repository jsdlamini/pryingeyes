# PryingEyes 0.9.1: icon buttons

## What changed

The website and the app now use icons in place of plain text buttons wherever an icon is clear on its own. Both share one set of line icons.

**Icons only**
- **Send (chat) and Post (groups):** a see-through magenta paper plane with no box around it.
  - It greys out until there's something to send.
  - It nudges forward when tapped. The motion is skipped if the device asks for reduced motion.
- **Report:** a flag, on posts and in chats.
- **Block:** a struck-through circle.
- **Delete post, remove a member, remove a passkey:** a bin.
- **Group search:** a magnifying glass.
- **Code actions menu and close:** dots and an ×.
- **Website header:** sign out is an exit arrow.
- **Calls (website):**
  - Answer, decline, mute and hang up are round green, red and grey buttons with a small caption underneath.
  - The incoming-call banner uses the same round buttons.

**Icon beside the words**

These actions keep their words, because an icon alone could be misread:
- Let in, Decline, Ask to join, Leave group.
- New code, Create group, Copy link, Download QR.
- Pause, Resume, Revoke.
- Allow messages and calls, Decline and block.
- Sign out.

The website's top menu also has an icon beside each section.

**Accessibility:** every icon-only button still has a spoken name (for example "Send", "Report", "Block"). Screen readers announce it, the website shows it as a tooltip on hover, and the automated tests use it to find the button.

## Documentation

- The documentation PDF (v1.10) describes the icon set in **Look and feel**.
- All screenshots were retaken.

## Upgrading

Nothing to install. Rebuild the site and the app as usual.

## Tested

- Server: 172 tests pass.
- Website end-to-end: 16 pass, 1 skipped.
- App end-to-end: 3 pass.
- App: 12 unit tests pass; typecheck and lint are clean.
