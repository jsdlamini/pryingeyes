import { sql } from "drizzle-orm";
import { db } from "@/db";
import { boot } from "@/server-boot";

export const dynamic = "force-dynamic";

/** Liveness for Docker and monitoring: the server finished starting and the database answers. */
export async function GET() {
  try {
    await boot();
    await db().execute(sql`select 1`);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
