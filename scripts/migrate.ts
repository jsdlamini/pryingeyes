import "./load-env";
import { closeDb, isEmbeddedDb, migrateDb } from "@/db";

/** Applies migrations. The website also does this itself when it starts (src/instrumentation.ts). */
async function main() {
  for (let attempt = 1; ; attempt++) {
    try {
      await migrateDb();
      console.log(`Migrations applied (${isEmbeddedDb() ? "built-in database" : "PostgreSQL server"}).`);
      break;
    } catch (e: any) {
      const msg = String(e?.cause?.message ?? e?.message ?? e);
      const transient = /terminated unexpectedly|ECONNREFUSED|ECONNRESET|starting up|shutting down/i.test(msg);
      if (!transient || attempt >= 15) throw e;
      console.log(`Database not ready yet (${msg}); retrying in 2s…`);
      await closeDb();
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await closeDb();
}
main().catch(async (e) => { console.error(e?.message ?? e); await closeDb(); process.exit(1); });
