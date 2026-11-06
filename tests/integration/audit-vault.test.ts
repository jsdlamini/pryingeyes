import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { sql, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit, verifyChain, anchorDay, erasePayloadsFor } from "@/lib/audit";
import { storeNumber, decryptNumberFor, normalisePhone, blindIndex } from "@/lib/vault";
import { resetAll, syntheticNumber } from "../helpers";

async function makeUser(handle = "owner1") {
  const [u] = await db().insert(schema.users).values({ handle, status: "active" }).returning();
  return u;
}

describe("audit chain", () => {
  beforeEach(resetAll);

  it("links every event and verifies", async () => {
    const u = await makeUser();
    for (let i = 0; i < 25; i++) await audit({ type: "gate.attempt", actorId: u.id, ownerId: u.id, payload: { i } });
    const r = await verifyChain(7);
    expect(r).toMatchObject({ ok: true, count: 25 });
  });

  it("keeps order and linkage under concurrent writers", async () => {
    const u = await makeUser();
    await Promise.all(Array.from({ length: 40 }, (_, i) => audit({ type: "gate.attempt", ownerId: u.id, payload: { i } })));
    expect((await verifyChain()).ok).toBe(true);
  });

  it("rejects updates and deletes at the database level", async () => {
    const u = await makeUser();
    await audit({ type: "token.created", ownerId: u.id, payload: { a: 1 } });
    const cause = (p: Promise<unknown>) => p.then(() => "no error", (e) => String(e?.cause?.message ?? e?.message));
    expect(await cause(db().execute(sql`DELETE FROM audit_events`))).toMatch(/append-only/);
    expect(await cause(db().execute(sql`UPDATE audit_events SET type = 'x'`))).toMatch(/immutable/);
    expect(await cause(db().execute(sql`UPDATE audit_events SET payload = '{"a":2}'::jsonb`))).toMatch(/immutable/);
    expect(await cause(db().execute(sql`UPDATE audit_events SET payload = NULL`))).toBe("no error");
  });

  it("detects a tampered payload even if the trigger were bypassed", async () => {
    const u = await makeUser();
    await audit({ type: "token.created", ownerId: u.id, payload: { a: 1 } });
    await audit({ type: "token.revoked", ownerId: u.id, payload: { a: 2 } });
    await db().execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_guard_trg`);
    await db().execute(sql`UPDATE audit_events SET payload = '{"a":99}'::jsonb WHERE seq = 1`);
    await db().execute(sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_guard_trg`);
    const r = await verifyChain();
    expect(r.ok).toBe(false);
    expect(r.problem?.seq).toBe(1);
  });

  it("still verifies after payload erasure", async () => {
    const u = await makeUser();
    await audit({ type: "token.created", ownerId: u.id, payload: { label: "x" } });
    await audit({ type: "gate.attempt", actorId: u.id, payload: { y: 1 } });
    expect(await erasePayloadsFor(u.id)).toBe(2);
    expect((await verifyChain()).ok).toBe(true);
  });

  it("anchors the day's head to a write-once file", async () => {
    const u = await makeUser();
    await audit({ type: "token.created", ownerId: u.id });
    const a = await anchorDay();
    expect(a?.hash).toMatch(/^[0-9a-f]{64}$/);
    const file = `${process.env.AUDIT_ANCHOR_DIR}/${a!.day}.anchor`;
    expect(JSON.parse(fs.readFileSync(file, "utf8")).hash).toBe(a!.hash);
    expect(() => fs.writeFileSync(file, "tamper", { flag: "wx" })).toThrow();
    expect((await anchorDay())?.hash).toBe(a!.hash); // idempotent
    expect((await verifyChain()).ok).toBe(true);
  });
});

describe("number vault", () => {
  beforeEach(resetAll);

  it("normalises formats to the same E.164 and blind index", () => {
    const a = normalisePhone("+268 7612 3456"), b = normalisePhone("7612 3456"), c = normalisePhone("00268-76123456");
    expect(a.e164).toBe("+26876123456");
    expect(b.e164).toBe(a.e164);
    expect(c.e164).toBe(a.e164);
    expect(blindIndex(a.e164)).toBe(blindIndex(b.e164));
    expect(() => normalisePhone("12")).toThrow();
    expect(() => normalisePhone("not a number")).toThrow();
  });

  it("stores only ciphertext and decrypts for authorised purposes", async () => {
    const u = await makeUser();
    const n = syntheticNumber();
    const stored = await storeNumber(u.id, n, "protected", "personal");
    const [row] = await db().select().from(schema.phoneNumbers).where(eq(schema.phoneNumbers.id, stored.id));
    expect(row.ciphertext.toString("latin1")).not.toContain(n.slice(4));
    expect(row.hint).toBe(n.slice(-2));
    expect(await decryptNumberFor(stored.id, "reveal")).toBe(n);
  });

  it("rejects duplicates entered in a different format", async () => {
    const u = await makeUser();
    const n = syntheticNumber();
    await storeNumber(u.id, n, "protected");
    await expect(storeNumber(u.id, n.replace("+268", "00268 "), "protected")).rejects.toThrow(/already/);
  });

  it("prevents one account phone being linked to two accounts", async () => {
    const a = await makeUser("a1"), b = await makeUser("b1");
    const n = syntheticNumber();
    await storeNumber(a.id, n, "account");
    await expect(storeNumber(b.id, n, "account")).rejects.toThrow(/another account/);
  });

  it("binds ciphertext to its row (swapping ciphertexts fails)", async () => {
    const u = await makeUser();
    const x = await storeNumber(u.id, syntheticNumber(), "protected");
    const y = await storeNumber(u.id, syntheticNumber(), "protected");
    const [rx] = await db().select().from(schema.phoneNumbers).where(eq(schema.phoneNumbers.id, x.id));
    await db().update(schema.phoneNumbers).set({ ciphertext: rx.ciphertext }).where(eq(schema.phoneNumbers.id, y.id));
    await expect(decryptNumberFor(y.id, "reveal")).rejects.toThrow();
  });
});
