/**
 * Locale strings. English first; add siSwati, Setswana, isiZulu etc. as sibling objects with the
 * same keys and select by user preference.
 */
const en = {
  "app.tagline": "Share a code, not your number.",
  "nav.dashboard": "My codes", "nav.requests": "Requests", "nav.chats": "Chats", "nav.groups": "Groups", "nav.audit": "Audit trail",
  "nav.numbers": "Numbers", "nav.settings": "Settings", "nav.moderation": "Moderation", "nav.admin": "Admin", "nav.signout": "Sign out",
  "gate.reaching": "You're trying to reach",
  "gate.signin": "Sign in to continue",
  "gate.signin.why": "Every request is tied to a verified account. That's what keeps people who share their codes safe.",
  "gate.human": "Human check",
  "gate.continue": "Continue",
  "gate.unavailable.title": "This code isn't available",
  "gate.unavailable.body": "It may have expired, been switched off, or the owner may not be taking requests right now.",
  "gate.limited": "Too many attempts. Please try again later.",
  "gate.captcha_failed": "The human check didn't pass. Please try again.",
  "gate.step.signedin": "Signed in",
  "gate.step.human": "Human check passed",
  "gate.step.human.todo": "Human check",
  "gate.step.code": "Code confirmed",
  "gate.step.code.todo": "Confirm it's you",
  "gate.step.ask": "Ask the owner",
  "gate.step.asked": "Owner said yes",
  "gate.otp.title": "Confirm it's you",
  "gate.otp.send": "Send me a code",
  "gate.otp.sent": "We emailed you a 6-digit code.",
  "gate.otp.verify": "Confirm code",
  "gate.otp.wrong": "That code didn't match. Check it and try again.",
  "gate.consent.note": "Add a short note (optional)",
  "gate.consent.send": "Send request",
  "gate.consent.waiting": "Waiting for the owner",
  "gate.consent.waiting.body": "They'll see your request with your note. Requests expire after 24 hours.",
  "gate.choose": "How would you like to connect?",
  "gate.reveal": "Show the number",
  "gate.chat": "Chat in the app",
  "gate.appcall": "Call in the app",
  "gate.appcall.desc": "Talk over the internet (mobile data or Wi‑Fi, about 0.3 MB a minute). No phone numbers are used. If they don't have PryingEyes open, they'll see a missed call and can reply in the chat.",
  "gate.chat.desc": "Send private messages here on PryingEyes. The owner gets a notification and replies in the app. No numbers are shared.",
  "gate.chat.disappear": "Messages disappear after 24 hours.",
  "gate.reveal.desc": "See the number for 60 seconds as an image stamped with your handle. The owner can see that you viewed it.",
  "gate.reveal.hidden": "Hidden in",
  "gate.reveal.logged": "This view is an image stamped with your handle. Every view is logged and visible to the owner.",
  "gate.privacy": "The owner sees your handle, how you were checked and your region. They never see your number.",
  "common.block": "Block", "common.report": "Report",
} as const;

export type Key = keyof typeof en;
const locales: Record<string, Partial<Record<Key, string>>> = { en };

export function t(key: Key, locale = "en"): string {
  return locales[locale]?.[key] ?? en[key];
}
