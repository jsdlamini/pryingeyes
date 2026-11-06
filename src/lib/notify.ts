/** Owner notifications: in-app always, plus email when the account has a verified address (rule 13). */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "./env";
import { sendEmail } from "./providers";
import { log } from "./log";

export type NotifyKind = "consent_request" | "security_alert" | "token_frozen" | "lockout" | "relay_cap" | "recovery" | "info" | "report_update" | "new_chat" | "chat_message" | "missed_call" | "group_report" | "group_join_request" | "group_joined";

export async function notify(userId: string, n: { kind: NotifyKind; title: string; body?: string; link?: string; email?: boolean }) {
  await db().insert(schema.notifications).values({ userId, kind: n.kind, title: n.title, body: n.body ?? "", link: n.link ?? null });
  const [u] = await db().select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u) return;
  const url = n.link ? `${env().APP_URL}${n.link}` : env().APP_URL;
  if (n.email !== false && u.email && u.emailVerifiedAt) {
    await sendEmail({ userId, to: u.email, subject: `PryingEyes: ${n.title}`, text: `${n.title}\n\n${n.body ?? ""}\n\n${url}`, tag: n.kind })
      .catch((err) => log.warn({ err }, "notification email failed"));
  }
}
