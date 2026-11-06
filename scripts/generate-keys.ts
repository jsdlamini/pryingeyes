/**
 * Generates fresh secrets and writes them into .env (creating it from .env.example if needed).
 * Existing values are kept unless --force is given. Run once per environment.
 */
import crypto from "node:crypto";
import fs from "node:fs";

const force = process.argv.includes("--force");
const file = process.argv.find((a) => a.startsWith("--file="))?.slice(7) ?? ".env";

const { privateKey } = crypto.generateKeyPairSync("ed25519");
const fresh: Record<string, string> = {
  MASTER_KEK: crypto.randomBytes(32).toString("base64"),
  TOKEN_PEPPER: crypto.randomBytes(32).toString("base64"),
  BLIND_INDEX_KEY: crypto.randomBytes(32).toString("base64"),
  SECRETS_HMAC_KEY: crypto.randomBytes(32).toString("base64"),
  EVIDENCE_SIGNING_KEY: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  TURN_SECRET: crypto.randomBytes(32).toString("base64url"),
};

let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : fs.readFileSync(".env.example", "utf8");
for (const [k, v] of Object.entries(fresh)) {
  const re = new RegExp(`^${k}=(.*)$`, "m");
  const m = text.match(re);
  if (m && m[1].trim() && !m[1].includes("REPLACE_ME") && !force) continue;
  text = m ? text.replace(re, `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`;
}
fs.writeFileSync(file, text, { mode: 0o600 });
console.log(`Keys written to ${file}. Keep this file out of version control.`);
