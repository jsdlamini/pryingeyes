import { z } from "zod";

const b64key = (name: string) =>
  z.string({ error: `${name} is required (run npm run keys:generate)` })
    .refine((v) => Buffer.from(v, "base64").length === 32, { message: `${name} must be 32 bytes, base64-encoded` });

const int = (d: number) => z.coerce.number().int().nonnegative().default(d);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // APP_ENV decides whether development stand-ins are allowed. It is separate from NODE_ENV because
  // `next start` always runs with NODE_ENV=production, including local test runs on your desktop.
  APP_ENV: z.enum(["development", "staging", "production"]).optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  RP_ID: z.string().default(""),   // empty = APP_URL's host
  RP_NAME: z.string().default("PryingEyes"),
  // Empty = built in: PostgreSQL embedded in the app (PGlite) and an in-memory Redis.
  // Set them to use separate servers (needed to run more than one copy of the app).
  DATABASE_URL: z.string().default(""),
  REDIS_URL: z.string().default(""),
  // Where the built-in database keeps its files (and other runtime data).
  DATA_DIR: z.string().default("./var/data"),
  // Where uploaded photos and voice notes are kept. Empty = "uploads" next to DATA_DIR (./var/uploads; /app/var/uploads in Docker).
  UPLOAD_DIR: z.string().default(""),
  // Verified accounts with these emails become admins automatically (comma-separated).
  ADMIN_EMAILS: z.string().default(""),
  // on = the website runs the housekeeping jobs itself; off = run `npm run jobs` separately.
  BACKGROUND_JOBS: z.enum(["on", "off"]).default("on"),
  // The content bot (public notices). Off unless turned on; even then it starts paused until an admin resumes it.
  CONTENT_BOT: z.enum(["on", "off"]).default("off"),
  // How many notice posts the bot may make in one day (a gentle pace so it never floods a board).
  CONTENT_BOT_DAILY_CAP: int(10),
  // The bot's AI summariser. openai-compatible works with OpenAI, Groq, OpenRouter and local servers.
  AI_PROVIDER: z.enum(["off", "openai-compatible"]).default("off"),
  AI_BASE_URL: z.string().default(""),   // e.g. https://api.openai.com/v1
  AI_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default(""),

  // Keys (envelope encryption + keyed hashes). KEK_PREVIOUS = JSON {"1":"base64",...} for rotation.
  KEY_PROVIDER: z.enum(["local"]).default("local"),
  MASTER_KEK: b64key("MASTER_KEK"),
  MASTER_KEK_VERSION: z.coerce.number().int().positive().default(1),
  KEK_PREVIOUS: z.string().default("{}"),
  TOKEN_PEPPER: b64key("TOKEN_PEPPER"),
  BLIND_INDEX_KEY: b64key("BLIND_INDEX_KEY"),
  SECRETS_HMAC_KEY: b64key("SECRETS_HMAC_KEY"),
  EVIDENCE_SIGNING_KEY: z.string({ error: "EVIDENCE_SIGNING_KEY is required (run npm run keys:generate)" }),

  // Providers
  CAPTCHA_PROVIDER: z.enum(["dev", "turnstile"]).default("dev"),
  TURNSTILE_SITE_KEY: z.string().default(""),
  TURNSTILE_SECRET: z.string().default(""),
  EMAIL_PROVIDER: z.enum(["outbox", "resend"]).default("outbox"),
  RESEND_API_KEY: z.string().default(""),
  // Must be an address on a domain verified in Resend. onboarding@resend.dev works for testing,
  // but Resend only delivers it to the email address that owns the Resend account.
  EMAIL_FROM: z.string().default("PryingEyes <onboarding@resend.dev>"),
  EMAIL_REPLY_TO: z.string().default(""),

  // In-app (data) calls through our own TURN relay (coturn). TURN_URLS is comma-separated,
  // e.g. "turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp".
  TURN_URLS: z.string().default("turn:localhost:3478?transport=udp,turn:localhost:3478?transport=tcp"),
  TURN_SECRET: z.string().default(""),
  // Relay-only hides both people's IP addresses. Only development may turn it off.
  CALL_RELAY_ONLY: z.enum(["true", "false"]).default("true"),
  CALL_RING_SECONDS: int(45),

  // Development only: origins of the phone app's web build allowed to call the API (comma-separated).
  MOBILE_DEV_ORIGINS: z.string().default(""),

  // App links: tapping https://<APP_URL>/t/<code> or /g/<invite> opens the phone app when it's installed.
  ANDROID_PACKAGE: z.string().default("com.pryingeyes.app"),
  ANDROID_CERT_SHA256: z.string().default(""),     // comma-separated SHA-256 signing-cert fingerprints (AA:BB:…)
  IOS_BUNDLE_ID: z.string().default("com.pryingeyes.app"),
  IOS_TEAM_ID: z.string().default(""),
  APP_DOWNLOAD_URL: z.string().default(""),        // where "Get the app" points (store page or APK link)

  DEFAULT_COUNTRY: z.string().length(2).default("SZ"),
  TRUST_PROXY_HOPS: int(1),
  GATE_FLOOR_MS: int(200),

  // Decode-gate budgets (rule 7 defaults)
  RL_IP_PER_HOUR: int(30),
  RL_SIGNUP_PER_IP_HOUR: int(30),
  RL_CALLER_PER_DAY: int(10),
  RL_CALLER_TOKEN_PER_DAY: int(3),
  RL_TOKEN_PER_DAY: int(50),
  RL_FAILS_BEFORE_LOCK: int(5),
  RL_FAIL_WINDOW_SEC: int(900),
  RL_LOCK_BASE_SEC: int(3600),
  RL_LOCK_MAX_SEC: int(86400),
  RL_TOKEN_FAILS_BEFORE_FREEZE: int(10),
  RL_TOKEN_FAIL_WINDOW_SEC: int(3600),
  TIER2_DAILY_CAP: int(3),
  MAX_TOKENS_PER_NUMBER: int(10),

  AUDIT_ANCHOR_DIR: z.string().default("./var/anchors"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  LOG_FILE: z.string().optional(),
});

export type Env = z.infer<typeof schema> & { APP_ENV: "development" | "staging" | "production" };
let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  const e = { ...parsed.data, RP_ID: parsed.data.RP_ID.trim() || new URL(parsed.data.APP_URL).hostname, APP_ENV: parsed.data.APP_ENV ?? (parsed.data.NODE_ENV === "production" ? "production" : "development") } as const;
  if (e.EMAIL_PROVIDER === "resend") {
    if (!/^re_[A-Za-z0-9_]{8,}$/.test(e.RESEND_API_KEY)) throw new Error("Invalid configuration:\nRESEND_API_KEY: set your Resend API key (starts with re_) or use EMAIL_PROVIDER=outbox");
    if (!/<?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?\s*$/.test(e.EMAIL_FROM)) throw new Error("Invalid configuration:\nEMAIL_FROM: must be an address, e.g. PryingEyes <no-reply@yourdomain.com>");
  }
  if (e.AI_PROVIDER === "openai-compatible") {
    if (!/^https:\/\//.test(e.AI_BASE_URL)) throw new Error("Invalid configuration:\nAI_BASE_URL: must be https (e.g. https://api.openai.com/v1) when AI_PROVIDER=openai-compatible");
    if (!e.AI_API_KEY) throw new Error("Invalid configuration:\nAI_API_KEY: required when AI_PROVIDER=openai-compatible");
    if (!e.AI_MODEL) throw new Error("Invalid configuration:\nAI_MODEL: required when AI_PROVIDER=openai-compatible");
  }
  if (e.APP_ENV !== "development") {
    const problems: string[] = [];
    if (e.EMAIL_PROVIDER === "resend" && /@resend\.dev>?\s*$/i.test(e.EMAIL_FROM))
      problems.push("EMAIL_FROM must use your own verified domain in production (resend.dev only delivers to the account owner)");
    if (e.CAPTCHA_PROVIDER === "dev") problems.push("CAPTCHA_PROVIDER=dev is not allowed in production");
    if (e.TURN_SECRET.length < 32) problems.push("TURN_SECRET must be set (32+ characters, shared with coturn's static-auth-secret)");
    if (!/^turns?:/.test(e.TURN_URLS) || /localhost|127\.0\.0\.1/.test(e.TURN_URLS)) problems.push("TURN_URLS must point at your public TURN server");
    if (e.MOBILE_DEV_ORIGINS) problems.push("MOBILE_DEV_ORIGINS is for development only; leave it empty");
    if (e.CALL_RELAY_ONLY !== "true") problems.push("CALL_RELAY_ONLY must be true in production (it hides callers' IP addresses)");
    if (e.EMAIL_PROVIDER === "outbox") problems.push("EMAIL_PROVIDER=outbox is not allowed in production (use resend)");
    if (!e.APP_URL.startsWith("https://")) problems.push("APP_URL must be https in production");
    if (/localhost|127\.0\.0\.1/.test(e.APP_URL)) problems.push("APP_URL must be your public address (e.g. https://pryingeyes.example.com), not localhost");
    if (e.RP_ID !== new URL(e.APP_URL).hostname && !new URL(e.APP_URL).hostname.endsWith(`.${e.RP_ID}`)) problems.push("RP_ID must be APP_URL's host or a parent domain of it (or leave it empty)");
    if (problems.length) throw new Error(`Unsafe ${e.APP_ENV} configuration (APP_ENV=${e.APP_ENV}):\n${problems.join("\n")}`);
  }
  cached = e;
  return e;
}

export const isProd = () => env().APP_ENV === "production";
/** Test hook only. */
export function resetEnvCache() { cached = null; }
