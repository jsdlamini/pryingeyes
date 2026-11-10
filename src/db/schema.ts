/**
 * PryingEyes database schema (Drizzle ORM, PostgreSQL).
 *
 * Data-protection notes:
 *  - Phone numbers are only ever stored as AES-256-GCM ciphertext (`phone_numbers.ciphertext`)
 *    plus a keyed blind index. `hint` holds the last two digits only, for UI disambiguation.
 *  - Tokens are only ever stored as HMAC-SHA256(token, pepper). `display_prefix` is the first
 *    four characters (20 of 80 bits) so owners can tell tokens apart.
 *  - Free text written by people (intro notes, chat messages, report details) is encrypted.
 *  - Audit payloads contain identifiers only; payloads can be erased without breaking the chain
 *    because each link hashes `payload_hash`, not the payload.
 */
import {
  pgTable, uuid, text, timestamp, integer, boolean, bigserial, bigint, jsonb,
  customType, uniqueIndex, index, primaryKey, date, pgEnum, AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const userStatus = pgEnum("user_status", ["pending", "active", "suspended"]);
export const phoneKind = pgEnum("phone_kind", ["account", "protected"]);
export const tokenClass = pgEnum("token_class", ["standard", "expiring", "disposable", "purpose"]);
export const tokenStatus = pgEnum("token_status", ["active", "paused", "frozen", "revoked", "expired", "consumed"]);
export const requestStage = pgEnum("request_stage", [
  "started",        // passed status/standing/captcha/budget checks
  "otp_sent",
  "verified",       // OTP passed (Tier 2+) or no OTP needed (Tier 1)
  "consent_pending",
  "approved_relay",
  "approved_reveal",
  "declined",
  "expired",
  "completed",      // outcome delivered (reveal, chat, in-app call)
]);
export const reportStatus = pgEnum("report_status", ["open", "actioned", "dismissed"]);
export const adminActionStatus = pgEnum("admin_action_status", ["pending", "executed", "rejected", "expired"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  handle: text("handle").notNull(),
  email: text("email"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  passwordHash: text("password_hash"),
  status: userStatus("status").notNull().default("pending"),
  roles: text("roles").array().notNull().default(sql`'{}'::text[]`),
  ageConfirmedAt: timestamp("age_confirmed_at", { withTimezone: true }),
  auditRetentionMonths: integer("audit_retention_months").notNull().default(12),
  readReceipts: boolean("read_receipts").notNull().default(true),
  doNotDisturb: boolean("do_not_disturb").notNull().default(false),
  avatarUrl: text("avatar_url"),
  shareCodeByDefault: boolean("share_code_by_default").notNull().default(true),
  panicAt: timestamp("panic_at", { withTimezone: true }),
  totpLastStep: bigint("totp_last_step", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("users_handle_uq").on(sql`lower(${t.handle})`),
  uniqueIndex("users_email_uq").on(t.email),
]);

/** Per-user data key, wrapped by the KeyProvider (envelope encryption). */
export const userKeys = pgTable("user_keys", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  wrappedKey: bytea("wrapped_key").notNull(),
  kekVersion: integer("kek_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const phoneNumbers = pgTable("phone_numbers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: phoneKind("kind").notNull(),
  ciphertext: bytea("ciphertext").notNull(),
  blindIndex: text("blind_index").notNull(),
  country: text("country"),
  hint: text("hint").notNull(),
  label: text("label").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("phone_user_kind_bi_uq").on(t.userId, t.kind, t.blindIndex),
  uniqueIndex("phone_account_bi_uq").on(t.blindIndex).where(sql`${t.kind} = 'account'`),
]);

export const totpSecrets = pgTable("totp_secrets", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  secretEnc: bytea("secret_enc").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const passkeys = pgTable("passkeys", {
  id: text("id").primaryKey(), // credential id (base64url)
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  publicKey: bytea("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: text("transports").array().notNull().default(sql`'{}'::text[]`),
  name: text("name").notNull().default("Passkey"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (t) => [index("passkeys_user_idx").on(t.userId)]);

export const recoveryCodes = pgTable("recovery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
}, (t) => [index("recovery_user_idx").on(t.userId)]);

export const accountRecoveries = pgTable("account_recoveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie secret
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  mfaAt: timestamp("mfa_at", { withTimezone: true }),
  mfaPending: boolean("mfa_pending").notNull().default(false),
  uaHash: text("ua_hash").notNull(),
  deviceLabel: text("device_label").notNull().default("Unknown device"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

/** Email-link verification and other single-use secrets (stored hashed). */
export const verificationTokens = pgTable("verification_tokens", {
  hash: text("hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/** One-time passcodes (hashed). Purged after 90 days. */
export const otpChallenges = pgTable("otp_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(),
  subject: text("subject"), // e.g. decode request id or pending phone blind index
  codeHash: text("code_hash").notNull(),
  channel: text("channel").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("otp_subject_idx").on(t.purpose, t.subject)]);

export const tokens = pgTable("tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Null for app-only codes: reachable by message and in-app call, with no phone number behind them.
  numberId: uuid("number_id").references(() => phoneNumbers.id, { onDelete: "cascade" }),
  linkHash: text("link_hash").notNull(),
  shortHash: text("short_hash").notNull(),
  displayPrefix: text("display_prefix").notNull(),
  class: tokenClass("class").notNull(),
  tier: integer("tier").notNull(),
  context: text("context").notNull().default("other"),
  label: text("label").notNull(),
  status: tokenStatus("status").notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  decodeBudget: integer("decode_budget"),
  uses: integer("uses").notNull().default(0),
  rotationDueAt: timestamp("rotation_due_at", { withTimezone: true }),
  rotatedFromId: uuid("rotated_from_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tokens_link_hash_uq").on(t.linkHash),
  uniqueIndex("tokens_short_hash_uq").on(t.shortHash),
  index("tokens_owner_idx").on(t.ownerId),
  index("tokens_number_idx").on(t.numberId),
]);

export const decodeRequests = pgTable("decode_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenId: uuid("token_id").notNull().references(() => tokens.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  callerId: uuid("caller_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tier: integer("tier").notNull(),
  stage: requestStage("stage").notNull().default("started"),
  verification: text("verification").notNull().default("account+captcha"),
  region: text("region"),
  noteEnc: bytea("note_enc"),
  outcome: text("outcome"),
  outcomeCounted: boolean("outcome_counted").notNull().default(false),
  consentExpiresAt: timestamp("consent_expires_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  index("dr_owner_idx").on(t.ownerId, t.stage),
  index("dr_caller_idx").on(t.callerId, t.createdAt),
]);

export const revealGrants = pgTable("reveal_grants", {
  id: text("id").primaryKey(), // random, unguessable
  requestId: uuid("request_id").notNull().references(() => decodeRequests.id, { onDelete: "cascade" }),
  callerId: uuid("caller_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/**
 * In-app (data) calls: browser-to-browser WebRTC through our TURN relay. No phone numbers are
 * involved. Only metadata is stored; media never touches the database. Signalling (SDP/ICE) is
 * kept briefly in Redis, never here.
 */
export const appCalls = pgTable("app_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").references(() => decodeRequests.id, { onDelete: "set null" }),
  tokenId: uuid("token_id").references(() => tokens.id, { onDelete: "set null" }),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  callerId: uuid("caller_id").references(() => users.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  // ringing | accepted | ended | declined | missed | cancelled | busy | failed
  status: text("status").notNull().default("ringing"),
  endedBy: text("ended_by"), // caller | owner | system
  durationSec: integer("duration_sec").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
}, (t) => [
  index("app_calls_owner_idx").on(t.ownerId, t.status),
  index("app_calls_caller_idx").on(t.callerId, t.status),
]);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenId: uuid("token_id").references(() => tokens.id, { onDelete: "set null" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  callerId: uuid("caller_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  disappearSeconds: integer("disappear_seconds"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("conv_pair_token_uq").on(t.tokenId, t.callerId),
  index("conv_owner_idx").on(t.ownerId),
  index("conv_caller_idx").on(t.callerId),
]);

export const reactions = pgTable("reactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  targetId: uuid("target_id").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("reaction_uq").on(t.userId, t.kind, t.targetId, t.emoji)]);

/** Uploaded media files. The file itself lives in the uploads folder as `<id>.<ext>`. */
export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ext: text("ext").notNull(),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("uploads_owner_idx").on(t.ownerId)]);

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").references(() => users.id, { onDelete: "set null" }),
  ciphertext: bytea("ciphertext").notNull(),
  attachment: text("attachment"),
  attachmentKind: text("attachment_kind"),
  viewOnce: boolean("view_once").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (t) => [index("msg_conv_idx").on(t.conversationId, t.createdAt)]);

export const blocks = pgTable("blocks", {
  blockerId: uuid("blocker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  blockedId: uuid("blocked_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })]);

export const follows = pgTable("follows", {
  followerId: uuid("follower_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  followedId: uuid("followed_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.followerId, t.followedId] })]);

export const comments = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  bodyEnc: bytea("body_enc").notNull(),
  parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, { onDelete: "cascade" }),
  attachment: text("attachment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("comments_post_idx").on(t.postId, t.createdAt)]);

/**
 * Safe social layer. Contact details are never posted as text: the composer's guard rejects
 * phone numbers and email addresses, and people attach a contact code instead. Post text and
 * attached codes are encrypted under the author's data key, so erasing an account erases them.
 */
export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  about: text("about").notNull().default(""),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  inviteHash: text("invite_hash").notNull(),          // HMAC of the invite code; the code is in invite_enc
  inviteEnc: bytea("invite_enc"),                     // encrypted under the issuing admin's data key
  inviteBy: uuid("invite_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastPostAt: timestamp("last_post_at", { withTimezone: true }),
  // Listed groups appear in search, so anyone can ask to join. Unlisted ones are reached by invite link only.
  listed: boolean("listed").notNull().default(true),
}, (t) => [uniqueIndex("groups_invite_uq").on(t.inviteHash)]);

/** Asking to join a group. Only the group's creator or admins can approve (or decline) it. */
export const groupJoinRequests = pgTable("group_join_requests", {
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  note: text("note").notNull().default(""),           // short, passes the contact-details guard
  via: text("via").notNull().default("search"),       // search | invite
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index("group_join_requests_user_idx").on(t.userId)]);

export const groupMembers = pgTable("group_members", {
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),     // admin | member
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index("group_members_user_idx").on(t.userId)]);

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }),   // null = status update
  authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  bodyEnc: bytea("body_enc").notNull(),
  tokenId: uuid("token_id").references(() => tokens.id, { onDelete: "set null" }),
  codeEnc: bytea("code_enc"),                          // the attached contact code (short + link form)
  attachment: text("attachment"),                      // uploaded image URL (/uploads/...)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (t) => [
  index("posts_group_idx").on(t.groupId, t.createdAt),
  index("posts_author_idx").on(t.authorId, t.createdAt),
]);

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
  reportedUserId: uuid("reported_user_id").references(() => users.id, { onDelete: "set null" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  tokenId: uuid("token_id").references(() => tokens.id, { onDelete: "set null" }),
  postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  detailsEnc: bytea("details_enc"),          // reporter's own words + messages they chose to attach
  status: reportStatus("status").notNull().default("open"),
  assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
}, (t) => [index("reports_status_idx").on(t.status, t.createdAt)]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  link: text("link"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (t) => [index("notif_user_idx").on(t.userId, t.createdAt)]);

export const auditEvents = pgTable("audit_events", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  type: text("type").notNull(),
  actorId: uuid("actor_id"),        // not FK: survives erasure as an opaque id
  ownerId: uuid("owner_id"),        // whose feed this event belongs to
  subjectType: text("subject_type"),
  subjectId: text("subject_id"),
  payload: jsonb("payload"),        // identifiers/enums only; nulled on erasure/retention
  payloadHash: text("payload_hash").notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
}, (t) => [index("audit_owner_idx").on(t.ownerId, t.seq), uniqueIndex("audit_hash_uq").on(t.hash)]);

export const auditAnchors = pgTable("audit_anchors", {
  day: date("day").primaryKey(),
  seq: bigint("seq", { mode: "number" }).notNull(),
  hash: text("hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminActions = pgTable("admin_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  action: text("action").notNull(),
  params: jsonb("params").notNull(),
  reason: text("reason").notNull(),
  requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
  approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
  status: adminActionStatus("status").notNull().default("pending"),
  result: text("result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

/** Development-only message capture (SMS, email, voice). Never written in production. */
export const devOutbox = pgTable("dev_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  channel: text("channel").notNull(),
  userId: uuid("user_id"),
  to: text("to").notNull(), // email address, or a MASKED phone number (····56) — never a full number
  subject: text("subject").notNull().default(""),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
