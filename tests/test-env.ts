/** Deterministic test configuration. Uses a separate database and Redis DB 15. */
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3100",
  RP_ID: "localhost",
  // TEST_DATABASE_URL=embedded runs the suite on the built-in database; TEST_REDIS_URL=memory on the in-memory store.
  DATABASE_URL: process.env.TEST_DATABASE_URL === "embedded" ? "" : (process.env.TEST_DATABASE_URL ?? "postgresql://pryingeyes:pryingeyes@127.0.0.1:5433/pryingeyes_test"),
  REDIS_URL: process.env.TEST_REDIS_URL === "memory" ? "" : (process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/15"),
  DATA_DIR: "./var/test-data",
  MASTER_KEK: Buffer.alloc(32, 1).toString("base64"),
  TOKEN_PEPPER: Buffer.alloc(32, 2).toString("base64"),
  BLIND_INDEX_KEY: Buffer.alloc(32, 3).toString("base64"),
  SECRETS_HMAC_KEY: Buffer.alloc(32, 4).toString("base64"),
  // Fixed ed25519 test key (PKCS#8 DER, base64) — test only.
  EVIDENCE_SIGNING_KEY: "MC4CAQAwBQYDK2VwBCIEIBERERERERERERERERERERERERERERERERERERERERER",
  CAPTCHA_PROVIDER: "dev",
  SMS_PROVIDER: "outbox",
  TURN_SECRET: "test-turn-secret-0123456789abcdefghijkl",
  TURN_URLS: "turn:turn.test:3478?transport=udp",
  CALL_RELAY_ONLY: "true",
  CALL_RING_SECONDS: "45",
  EMAIL_PROVIDER: "outbox",
  GATE_FLOOR_MS: "20",
  LOG_LEVEL: "info",
  LOG_FILE: "./var/test-logs/app.log",
  AUDIT_ANCHOR_DIR: "./var/test-anchors",
};
