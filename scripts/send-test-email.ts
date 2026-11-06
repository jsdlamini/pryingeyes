/**
 * Sends one test email through the configured provider, to check your Resend setup.
 *   npm run email:test -- --to=you@example.com
 * Tip: Resend's test inboxes delivered@resend.dev / bounced@resend.dev simulate outcomes.
 */
import "./load-env";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/providers";
import { closeDb } from "@/db";
import { closeRedis } from "@/lib/redis";

async function main() {
  const to = process.argv.find((a) => a.startsWith("--to="))?.slice(5);
  if (!to) throw new Error("Usage: npm run email:test -- --to=you@example.com");
  const e = env();
  console.log(`Provider: ${e.EMAIL_PROVIDER}   From: ${e.EMAIL_FROM}`);
  await sendEmail({ to, subject: "PryingEyes test email", tag: "test",
    text: `This is a test email from PryingEyes (${e.APP_URL}).\n\nIf you can read this, email delivery works.` });
  console.log(e.EMAIL_PROVIDER === "resend" ? "Sent through Resend. Check the inbox and https://resend.com/emails." : "Captured in the development outbox: open /dev/outbox.");
}
main().then(async () => { await closeDb(); await closeRedis(); })
  .catch(async (err) => { console.error(`Failed: ${err.message ?? err}`); await closeDb(); await closeRedis(); process.exit(1); });
