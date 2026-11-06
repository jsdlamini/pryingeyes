import { TEST_ENV } from "./test-env";
import fs from "node:fs";

export default async function setup() {
  Object.assign(process.env, TEST_ENV);
  fs.rmSync("./var/test-logs", { recursive: true, force: true });
  fs.rmSync("./var/test-anchors", { recursive: true, force: true });
  if (!TEST_ENV.DATABASE_URL) {   // built-in database: start from an empty folder
    fs.rmSync("./var/test-data", { recursive: true, force: true });
    const { migrateDb, closeDb } = await import("../src/db");
    await migrateDb();
    await closeDb();
    return;
  }
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: TEST_ENV.DATABASE_URL });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await client.end();
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const pool = new pg.default.Pool({ connectionString: TEST_ENV.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
}
