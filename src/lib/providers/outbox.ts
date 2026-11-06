import { db, schema } from "@/db";
import { env } from "../env";
import { log } from "../log";

/** Development capture of outgoing messages. Refuses to run in production. */
export async function captureToOutbox(m: { channel: "sms" | "email" | "voice"; userId?: string | null; to: string; subject?: string; body: string }) {
  if (env().APP_ENV === "production") throw new Error("Outbox provider is disabled in production");
  await db().insert(schema.devOutbox).values({ channel: m.channel, userId: m.userId ?? null, to: m.to, subject: m.subject ?? "", body: m.body });
  log.info({ channel: m.channel }, "message captured in dev outbox");
}
