/** Verifies the whole audit hash chain and checks every write-once anchor file against it. */
import "./load-env";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, closeDb, schema } from "@/db";
import { closeRedis } from "@/lib/redis";
import { verifyChain } from "@/lib/audit";
import { env } from "@/lib/env";

async function main() {
  const r = await verifyChain();
  const dir = env().AUDIT_ANCHOR_DIR;
  const problems: string[] = [];
  let anchorFiles = 0;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".anchor"))) {
      anchorFiles++;
      const a = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { day: string; seq: number; hash: string };
      const [row] = await db().select({ hash: schema.auditEvents.hash }).from(schema.auditEvents).where(eq(schema.auditEvents.seq, a.seq));
      if (!row || row.hash !== a.hash) problems.push(`anchor ${a.day} (seq ${a.seq}) does not match the log`);
    }
  }
  const ok = r.ok && problems.length === 0;
  console.log(JSON.stringify({ chain: r, anchorFilesChecked: anchorFiles, anchorProblems: problems, pass: ok }, null, 2));
  await closeDb(); await closeRedis();
  process.exit(ok ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await closeDb(); await closeRedis(); process.exit(2); });
