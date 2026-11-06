#!/usr/bin/env node
/**
 * Runs automatically before `npm run dev`, `npm run build` and `npm start` (predev/prebuild/prestart).
 * Plain Node, no dependencies, so it works on a production install too.
 *
 * - No .env yet: creates it from .env.example. With --dev it's set for this computer
 *   (APP_ENV=development, http://localhost:3000, the local call relay settings).
 * - Fills in any missing secret keys (never replaces existing ones).
 * - Refuses to invent new keys when data from earlier keys already exists: data encrypted with
 *   the old keys could never be read again. Restore your old .env instead.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dev = process.argv.includes("--dev");
const quiet = process.argv.includes("--quiet");
const file = process.env.ENV_FILE ?? ".env";
const say = (m) => { if (!quiet) console.log(m); };

const get = (text, k) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim().replace(/^"(.*)"$/, "$1") ?? "";
const set = (text, k, v) => (new RegExp(`^${k}=`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`);

let text;
let created = false;
if (fs.existsSync(file)) {
  text = fs.readFileSync(file, "utf8");
} else {
  if (!fs.existsSync(".env.example")) { console.error("No .env and no .env.example to start from."); process.exit(1); }
  text = fs.readFileSync(".env.example", "utf8");
  created = true;
  if (dev) {
    // .env.example is set up for the live server; this computer runs locally.
    for (const [k, v] of [["APP_ENV", "development"], ["APP_URL", "http://localhost:3000"], ["TURN_URLS", "turn:localhost:3478?transport=udp,turn:localhost:3478?transport=tcp"],
      ["TURN_CONFIG", "./docker/turnserver.conf"], ["TURN_CERTS", "./docker/no-certs"]]) text = set(text, k, v);
  }
}

const KEYS = ["MASTER_KEK", "TOKEN_PEPPER", "BLIND_INDEX_KEY", "SECRETS_HMAC_KEY", "EVIDENCE_SIGNING_KEY", "TURN_SECRET"];
const missing = KEYS.filter((k) => { const v = get(text, k); return !v || v.includes("REPLACE_ME"); });
const DATA_KEYS = missing.filter((k) => k !== "TURN_SECRET");

if (DATA_KEYS.length) {
  // .env is missing or lost its keys. If there's data, new keys would make it unreadable.
  const dataDir = path.resolve(get(text, "DATA_DIR") || "./var/data", "postgres");
  if (!get(text, "DATABASE_URL") && fs.existsSync(dataDir) && fs.readdirSync(dataDir).length) {
    console.error(`\n${created ? "There's no .env" : `.env is missing ${DATA_KEYS.join(", ")}`}, but the built-in database in ${dataDir} already holds data.\n` +
      "That data is encrypted with the old keys. Restore .env from your backup.\n" +
      "Only if you mean to start over: move that folder away, then start again.\n");
    process.exit(1);
  }
}

if (missing.length) {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const fresh = {
    MASTER_KEK: crypto.randomBytes(32).toString("base64"),
    TOKEN_PEPPER: crypto.randomBytes(32).toString("base64"),
    BLIND_INDEX_KEY: crypto.randomBytes(32).toString("base64"),
    SECRETS_HMAC_KEY: crypto.randomBytes(32).toString("base64"),
    EVIDENCE_SIGNING_KEY: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    TURN_SECRET: crypto.randomBytes(32).toString("base64url"),
  };
  for (const k of missing) text = set(text, k, fresh[k]);
}

if (created || missing.length) {
  fs.writeFileSync(file, text, { mode: 0o600 });
  if (created) say(`Created ${file} (${dev ? "for this computer" : "from .env.example"}). Back it up: its keys unlock your data.`);
  if (missing.length) say(`Generated: ${missing.join(", ")}.`);
}

const db = get(text, "DATABASE_URL") ? "PostgreSQL server" : `built in (${path.join(get(text, "DATA_DIR") || "./var/data", "postgres")})`;
const store = get(text, "REDIS_URL") ? "Redis server" : "built in (memory)";
say(`PryingEyes: ${get(text, "APP_ENV") || "development"} at ${get(text, "APP_URL") || "http://localhost:3000"} · database ${db} · cache ${store}`);
