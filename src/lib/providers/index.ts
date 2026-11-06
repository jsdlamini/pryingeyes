/** Email delivery. PryingEyes sends no text messages: sign-in and gate codes go by email. */
import { env } from "../env";
import { captureToOutbox } from "./outbox";
import { resendSend } from "./resend";
import { log } from "../log";

/**
 * Email. Production: Resend. Development: captured in the outbox (/dev/outbox). With
 * EMAIL_PROVIDER=resend in development, emails are sent through Resend AND captured, so the
 * outbox page and the automated tests keep working.
 */
export async function sendEmail(m: { userId?: string | null; to: string; subject: string; text: string; tag?: string }) {
  if (env().EMAIL_PROVIDER === "resend") {
    await resendSend({ to: m.to, subject: m.subject, text: m.text, tag: m.tag });
    if (env().APP_ENV === "development") await captureToOutbox({ channel: "email", userId: m.userId, to: m.to, subject: m.subject, body: m.text });
    return;
  }
  await captureToOutbox({ channel: "email", userId: m.userId, to: m.to, subject: m.subject, body: m.text });
}
