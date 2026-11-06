/**
 * Proves no phone number exists in plaintext anywhere we can look.
 *  1. Decrypts every stored number (with the vault keys) and searches every table, every log file
 *     and any extra files/dirs given with --path= for each number in several formats.
 *  2. Scans text values in every table and every log line for anything phone-number-shaped.
 *
 *   npm run scan:plaintext -- [--path=./backups/dump.sql] [--logs=./var/log]
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db, closeDb, schema } from "@/db";
import { closeRedis } from "@/lib/redis";
import { decryptNumberFor } from "@/lib/vault";
import { findPhoneShapes } from "@/lib/redact";
import "./load-env";

const extra = process.argv.filter((a) => a.startsWith("--path=")).map((a) => a.slice(7));
const logDirs = process.argv.filter((a) => a.startsWith("--logs=")).map((a) => a.slice(7));
if (!logDirs.length) logDirs.push("./var/log", "./var/test-logs");

function variants(e164: string): string[] {
  const digits = e164.replace(/\D/g, "");
  const out = new Set([e164, digits]);
  if (e164.startsWith("+268")) { const n = digits.slice(3); out.add(n); out.add(`${n.slice(0, 4)} ${n.slice(4)}`); out.add(`0${n}`); }
  out.add(digits.slice(-8));
  return [...out].filter((v) => v.replace(/\D/g, "").length >= 8);
}

function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const st = fs.statSync(dir);
  if (st.isFile()) return [dir];
  return fs.readdirSync(dir).flatMap((f) => files(path.join(dir, f)));
}

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

async function main() {
  const numbers = await db().select({ id: schema.phoneNumbers.id }).from(schema.phoneNumbers);
  const needles = new Set<string>();
  for (const n of numbers) for (const v of variants(await decryptNumberFor(n.id, "export"))) needles.add(v);

  const tables = (await db().execute<{ t: string }>(sql`SELECT tablename t FROM pg_tables WHERE schemaname = 'public'`)).rows.map((r) => r.t);
  const findings: string[] = [];
  let rowsScanned = 0;
  for (const t of tables) {
    const rows = (await db().execute<{ j: string }>(sql.raw(`SELECT row_to_json(x)::text j FROM "${t}" x`))).rows;
    for (const { j } of rows) {
      rowsScanned++;
      for (const n of needles) if (j.includes(n)) findings.push(`table ${t}: contains a stored number (${n.slice(0, 3)}…)`);
      for (const s of strings(JSON.parse(j))) {
        if (s.startsWith("\\x")) continue; // bytea ciphertext
        for (const shape of findPhoneShapes(s)) findings.push(`table ${t}: phone-shaped text "${shape.slice(0, 4)}…"`);
      }
    }
  }
  let linesScanned = 0;
  for (const f of [...logDirs.flatMap(files), ...extra.flatMap(files)]) {
    const text = fs.readFileSync(f, "utf8");
    linesScanned += text.split("\n").length;
    for (const n of needles) if (text.includes(n)) findings.push(`file ${f}: contains a stored number`);
    for (const shape of findPhoneShapes(text)) findings.push(`file ${f}: phone-shaped text "${shape.slice(0, 4)}…"`);
  }
  const result = { storedNumbersChecked: numbers.length, formatsPerNumber: numbers.length ? Math.round(needles.size / numbers.length) : 0,
    tables: tables.length, rowsScanned, logLinesScanned: linesScanned, findings: [...new Set(findings)].slice(0, 50), pass: findings.length === 0 };
  console.log(JSON.stringify(result, null, 2));
  await closeDb(); await closeRedis();
  process.exit(result.pass ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await closeDb(); await closeRedis(); process.exit(2); });
