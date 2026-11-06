# PryingEyes 0.9.0: a new look

## What changed

The website and the phone app now share one visual style, based on the *Talk Sense* social app concept you sent from Dribbble.

- **Background:** a soft blush-to-lilac gradient behind every page and screen. Dark mode gets a deep plum version.
- **Cards:** frosted, translucent white with large rounded corners and a faint pink shadow.
- **Type:**
  - Merriweather (serif) for page titles, names, codes and the call timer.
  - Inter for everything you read and type.
  - Both fonts ship with the site and the app, so nothing is loaded from Google or any other server.
- **Buttons:** ink-black pills for the main action, white pills for the rest. Chips and choices are pills, and the selected one turns black.
- **Accent:** magenta for links, highlights and notification badges. The text shade passes WCAG AA contrast on white.
- **Chat:**
  - Your bubbles are black and theirs are white, with the time inside each bubble.
  - The composer is a round code button and a pill-shaped "Type a message here…" field.
- **Statuses:** avatars are rounded squares, ringed in magenta when there's something new.
- **Calls:** a plum-to-ink call screen with a pale pink timer and round controls. The incoming-call banner matches.
- **Website header:** stays at the top as you scroll, and the current page is shown as a black pill.

Nothing about how codes, groups, chats or calls work has changed.

## Documentation

- The system documentation PDF (v1.9) has a new **Look and feel** section in the *System's screens* chapter.
- All 23 screenshots (12 website, 11 app) were retaken from the running system in the new style.
- To retake them yourself:

```bash
cd mobile && npx expo export --platform web --output-dir dist-web && cd ..
npx playwright test -c playwright.screens.config.ts
```

## Upgrading

Run `npm install` in the project root and in `mobile/` to pick up the new font packages and `expo-linear-gradient`. Rebuild the installed app afterwards, because `expo-linear-gradient` is a native module.

There are no database or `.env` changes.

## Tested

- Server: 172 tests pass.
- Website end-to-end: 16 pass, 1 skipped.
- App end-to-end: 3 pass.
- App: 12 unit tests pass; typecheck, lint and the Android export are clean.
- Plaintext scan passes.
