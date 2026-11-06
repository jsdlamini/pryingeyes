import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { resetEnvCache } from "@/lib/env";
import { grantConfiguredAdmins } from "@/lib/bootstrap-admins";
import { MemoryRedis } from "@/lib/memory-redis";
import { resetAll } from "../helpers";
import { Client } from "../client";
import { emailOwner } from "../flows";

describe("first administrators from ADMIN_EMAILS", () => {
  beforeEach(resetAll);
  afterEach(() => { delete process.env.ADMIN_EMAILS; resetEnvCache(); });

  it("makes a listed email an admin as soon as it's verified; others stay ordinary", async () => {
    process.env.ADMIN_EMAILS = " Boss@Example.test , other@example.test"; resetEnvCache();
    const boss = await emailOwner(new Client(), "boss@example.test");
    const someone = await emailOwner(new Client());
    const roles = async (email: string) => (await db().select().from(schema.users).where(eq(schema.users.email, email)))[0].roles;
    expect(await roles(boss.email)).toContain("admin");
    expect(await roles(someone.email)).not.toContain("admin");
    // Recorded in the audit chain, and running it again changes nothing.
    const events = await db().select().from(schema.auditEvents).where(eq(schema.auditEvents.type, "admin.executed"));
    expect(events.some((e) => (e.payload as { source?: string })?.source === "ADMIN_EMAILS")).toBe(true);
    expect(await grantConfiguredAdmins()).toBe(0);
  });

  it("does nothing when the list is empty", async () => {
    const u = await emailOwner(new Client());
    expect(await grantConfiguredAdmins()).toBe(0);
    expect((await db().select().from(schema.users).where(eq(schema.users.email, u.email)))[0].roles).not.toContain("admin");
  });
});

describe("built-in cache (no Redis server)", () => {
  it("handles expiry, NX, counters, lists, multi and the rate-limit script", async () => {
    const r = new MemoryRedis();
    expect(await r.set("a", "1", "EX", 1, "NX")).toBe("OK");
    expect(await r.set("a", "2", "EX", 1, "NX")).toBeNull();
    expect(await r.get("a")).toBe("1");
    expect(await r.pttl("a")).toBeGreaterThan(0);
    expect(await r.incr("n")).toBe(1); expect(await r.decr("n")).toBe(0);
    await r.multi().rpush("l", "x").rpush("l", "y").rpush("l", "z").ltrim("l", -2, -1).expire("l", 60).exec();
    const res = await r.multi().lrange("l", 0, -1).del("l").exec();
    expect(res[0][1]).toEqual(["y", "z"]); expect(await r.exists("l")).toBe(0);
    const lua = "local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end local ttl = redis.call('TTL', KEYS[1]) return {c, ttl}";
    expect(await r.eval(lua, 1, "rl:x", 30)).toEqual([1, 30]);
    expect(await r.eval(lua, 1, "rl:x", 30)).toEqual([2, 30]);
    expect(await r.getdel("a")).toBe("1"); expect(await r.get("a")).toBeNull();
    await new Promise((ok) => setTimeout(ok, 30));
    await r.set("short", "v", "PX", 10); await new Promise((ok) => setTimeout(ok, 25));
    expect(await r.get("short")).toBeNull();
    await r.quit();
  });
});
