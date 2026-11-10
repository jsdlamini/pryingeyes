import { sql } from "drizzle-orm";
import { db } from "@/db";
import { redis } from "@/lib/redis";
import fs from "node:fs";

const TABLES = [
  "dev_outbox", "posts", "group_members", "groups", "admin_actions", "audit_anchors", "audit_events", "notifications", "reports", "blocks", "messages",
  "conversations", "app_calls", "reveal_grants", "decode_requests", "tokens", "otp_challenges",
  "verification_tokens", "sessions", "account_recoveries", "recovery_codes", "passkeys", "totp_secrets",
  "phone_numbers", "user_keys", "users",
];

export async function resetAll() {
  await db().execute(sql.raw(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`));
  await redis().flushdb();
  fs.rmSync(process.env.AUDIT_ANCHOR_DIR ?? "./var/test-anchors", { recursive: true, force: true });
  fs.rmSync(process.env.UPLOAD_DIR ?? "./var/test-uploads", { recursive: true, force: true });
}

/** A synthetic Eswatini mobile number, generated at runtime. Never a stored real number. */
export function syntheticNumber(): string {
  const prefix = ["76", "78", "79"][Math.floor(Math.random() * 3)];
  const rest = Math.floor(Math.random() * 1e6).toString().padStart(6, "0");
  return `+268${prefix}${rest}`;
}
