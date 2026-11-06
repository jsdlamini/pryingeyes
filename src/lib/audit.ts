/**
 * Append-only, hash-chained audit log (rule 12).
 *
 * hash_n = SHA-256( prev_hash | seq | at | type | actor | owner | subject_type | subject_id | payload_hash )
 * payload_hash = SHA-256( canonical JSON of payload )
 *
 * Payloads hold identifiers and enums only. Erasure and retention null the payload but keep
 * payload_hash, so the chain still verifies after personal data is removed.
 */
import fs from "node:fs";
import path from "node:path";
import { and, asc, desc, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { db, schema, type DB } from "@/db";
import { sha256Hex } from "./crypto";
import { env } from "./env";

export const GENESIS = "0".repeat(64);
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Executor = DB | Tx;

export type AuditType =
  | "account.created" | "account.verified" | "account.login" | "account.login_failed" | "account.logout"
  | "account.mfa_enrolled" | "account.passkey_added" | "account.passkey_removed" | "account.recovery_started"
  | "account.recovery_completed" | "account.recovery_cancelled" | "account.password_changed"
  | "account.session_revoked" | "account.exported" | "account.erased" | "account.suspended" | "account.unsuspended"
  | "number.added" | "number.removed"
  | "token.created" | "token.paused" | "token.resumed" | "token.rotated" | "token.revoked" | "token.frozen"
  | "token.unfrozen" | "token.extended" | "token.consumed" | "token.expired" | "panic.revoke_all"
  | "gate.attempt" | "gate.rejected" | "gate.passed" | "gate.otp_sent" | "gate.otp_failed" | "gate.otp_passed"
  | "consent.requested" | "consent.approved_relay" | "consent.approved_reveal" | "consent.declined"
  | "consent.declined_blocked" | "consent.expired"
  | "reveal.granted" | "reveal.viewed"
  | "relay.started" | "relay.answered" | "relay.completed" | "relay.failed" | "relay.cap_reached"
  | "call.started" | "call.answered" | "call.ended" | "call.missed" | "call.declined" | "call.busy"
  | "chat.opened" | "chat.blocked" | "chat.reported"
  | "group.created" | "group.joined" | "group.join_requested" | "group.join_declined" | "group.left" | "group.member_removed" | "group.invite_reset"
  | "post.created" | "post.deleted" | "post.reported" | "post.rejected_contact" | "post.commented"
  | "moderation.action" | "admin.requested" | "admin.approved" | "admin.rejected" | "admin.executed"
  | "evidence.exported" | "retention.applied";

export interface AuditInput {
  type: AuditType;
  actorId?: string | null;
  ownerId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  payload?: Record<string, unknown> | null;
}

/** Deterministic JSON: sorted keys, no whitespace. */
export function canonical(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export function linkHash(r: {
  prevHash: string; seq: number; at: Date; type: string; actorId: string | null; ownerId: string | null;
  subjectType: string | null; subjectId: string | null; payloadHash: string;
}): string {
  return sha256Hex([
    r.prevHash, r.seq, r.at.toISOString(), r.type, r.actorId ?? "", r.ownerId ?? "",
    r.subjectType ?? "", r.subjectId ?? "", r.payloadHash,
  ].join("|"));
}

async function appendIn(tx: Tx, e: AuditInput) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(7340211)`);
  const last = await tx.select({ hash: schema.auditEvents.hash }).from(schema.auditEvents)
    .orderBy(desc(schema.auditEvents.seq)).limit(1);
  const prevHash = last[0]?.hash ?? GENESIS;
  const seqRes = await tx.execute<{ seq: string }>(sql`SELECT nextval(pg_get_serial_sequence('audit_events','seq')) AS seq`);
  const seq = Number(seqRes.rows[0].seq);
  const at = new Date();
  const payload = e.payload ?? null;
  const payloadHash = sha256Hex(canonical(payload));
  const row = {
    seq, at, type: e.type, actorId: e.actorId ?? null, ownerId: e.ownerId ?? null,
    subjectType: e.subjectType ?? null, subjectId: e.subjectId ?? null, payload, payloadHash, prevHash,
    hash: "",
  };
  row.hash = linkHash(row);
  await tx.insert(schema.auditEvents).values(row);
  return row;
}

/** Append one event. Pass a transaction to commit it atomically with the action it records. */
export async function audit(e: AuditInput, exec?: Executor) {
  if (exec && "rollback" in exec) return appendIn(exec as Tx, e);
  return (exec ?? db()).transaction((tx) => appendIn(tx, e));
}

export interface VerifyResult { ok: boolean; count: number; head: string; problem?: { seq: number; reason: string } }

/** Walks the whole chain in order, recomputing every link. */
export async function verifyChain(batch = 2000): Promise<VerifyResult> {
  let prev = GENESIS, count = 0, lastSeq = 0;
  for (;;) {
    const rows = await db().select().from(schema.auditEvents)
      .where(gt(schema.auditEvents.seq, lastSeq)).orderBy(asc(schema.auditEvents.seq)).limit(batch);
    if (!rows.length) break;
    for (const r of rows) {
      if (r.prevHash !== prev) return { ok: false, count, head: prev, problem: { seq: r.seq, reason: "broken link (prev_hash mismatch)" } };
      if (r.payload !== null && sha256Hex(canonical(r.payload)) !== r.payloadHash)
        return { ok: false, count, head: prev, problem: { seq: r.seq, reason: "payload does not match payload_hash" } };
      if (linkHash(r) !== r.hash) return { ok: false, count, head: prev, problem: { seq: r.seq, reason: "hash mismatch" } };
      prev = r.hash; count++; lastSeq = r.seq;
    }
  }
  // Every anchor must lie on the chain.
  const anchors = await db().select().from(schema.auditAnchors);
  for (const a of anchors) {
    const r = await db().select({ hash: schema.auditEvents.hash }).from(schema.auditEvents).where(eq(schema.auditEvents.seq, a.seq));
    if (!r[0] || r[0].hash !== a.hash) return { ok: false, count, head: prev, problem: { seq: a.seq, reason: `anchor ${a.day} not on chain` } };
  }
  return { ok: true, count, head: prev };
}

/**
 * Writes the head hash for `day` (UTC) to the anchors table and to a write-once file
 * (created exclusively, then made read-only). Idempotent per day.
 */
export async function anchorDay(day: Date = new Date()): Promise<{ day: string; seq: number; hash: string } | null> {
  const d = day.toISOString().slice(0, 10);
  const end = new Date(`${d}T23:59:59.999Z`);
  const head = await db().select().from(schema.auditEvents)
    .where(lt(schema.auditEvents.at, end)).orderBy(desc(schema.auditEvents.seq)).limit(1);
  if (!head[0]) return null;
  const existing = await db().select().from(schema.auditAnchors).where(eq(schema.auditAnchors.day, d));
  if (existing[0]) return { day: d, seq: existing[0].seq, hash: existing[0].hash };
  const dir = env().AUDIT_ANCHOR_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${d}.anchor`);
  const line = JSON.stringify({ day: d, seq: head[0].seq, hash: head[0].hash, writtenAt: new Date().toISOString() });
  try {
    fs.writeFileSync(file, line + "\n", { flag: "wx", mode: 0o444 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    // The write-once file wins. If it disagrees with the database, say so loudly.
    const prior = JSON.parse(fs.readFileSync(file, "utf8")) as { seq: number; hash: string };
    if (prior.hash !== head[0].hash && prior.seq === head[0].seq) throw new Error(`Anchor file ${file} disagrees with the audit log`);
    await db().insert(schema.auditAnchors).values({ day: d, seq: prior.seq, hash: prior.hash }).onConflictDoNothing();
    return { day: d, seq: prior.seq, hash: prior.hash };
  }
  await db().insert(schema.auditAnchors).values({ day: d, seq: head[0].seq, hash: head[0].hash }).onConflictDoNothing();
  return { day: d, seq: head[0].seq, hash: head[0].hash };
}

/** Null payloads (keeps hashes) for events owned by or acted on by a user. */
export async function erasePayloadsFor(userId: string, before?: Date) {
  const conds = [isNotNull(schema.auditEvents.payload),
    sql`(${schema.auditEvents.ownerId} = ${userId} OR ${schema.auditEvents.actorId} = ${userId})`];
  if (before) conds.push(lt(schema.auditEvents.at, before));
  const r = await db().update(schema.auditEvents).set({ payload: null }).where(and(...conds));
  return r.rowCount ?? 0;
}
