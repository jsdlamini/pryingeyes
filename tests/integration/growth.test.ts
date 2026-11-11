import { describe, expect, it, beforeEach } from "vitest";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { resetAll } from "../helpers";
import { emailCaller } from "../flows";
import { maybeTriggerGrowthLoop, dismissGrowthLoop, hasCode, recordLoopCodeCreated } from "@/lib/growth";
import * as tokensRoute from "@/app/api/tokens/route";
import { Client } from "../client";

describe("growth loop prompt", () => {
  beforeEach(async () => { await resetAll(); });

  async function userIdFor(handle: string): Promise<string> {
    const [u] = await db().select().from(schema.users).where(eq(schema.users.handle, handle));
    return u.id;
  }

  it("shows once for a new user without a code", async () => {
    const c = new Client();
    const { handle } = await emailCaller(c);
    const id = await userIdFor(handle);

    await maybeTriggerGrowthLoop(id);
    const [u] = await db().select().from(schema.users).where(eq(schema.users.id, id));
    expect(u.loopPrompt).toBe("shown");

    // calling again does not duplicate the audit or change state
    await maybeTriggerGrowthLoop(id);
    const audits = await db().select().from(schema.auditEvents).where(eq(schema.auditEvents.type, "growth.loop_prompt_shown" as any));
    expect(audits.length).toBe(1);
  });

  it("never shows to a user who already has a code", async () => {
    const c = new Client();
    const { handle } = await emailCaller(c);
    const id = await userIdFor(handle);

    // create an app-only code
    await c.post(tokensRoute.POST, "/x", { tier: 1, class: "standard", label: "Contact me", context: "other", numberId: null, fromLoop: true });
    expect(await hasCode(id)).toBe(true);

    await maybeTriggerGrowthLoop(id);
    const [u] = await db().select().from(schema.users).where(eq(schema.users.id, id));
    expect(u.loopPrompt).toBeNull();
  });

  it("dismisses for good and records the audit", async () => {
    const c = new Client();
    const { handle } = await emailCaller(c);
    const id = await userIdFor(handle);

    await maybeTriggerGrowthLoop(id);
    await dismissGrowthLoop(id);
    const [u] = await db().select().from(schema.users).where(eq(schema.users.id, id));
    expect(u.loopPrompt).toBe("dismissed");

    await maybeTriggerGrowthLoop(id);
    const [u2] = await db().select().from(schema.users).where(eq(schema.users.id, id));
    expect(u2.loopPrompt).toBe("dismissed");
    const d = await db().select().from(schema.auditEvents).where(eq(schema.auditEvents.type, "growth.loop_dismissed" as any));
    expect(d.length).toBe(1);
  });

  it("clears the prompt and records the event when a code is made from the loop", async () => {
    const c = new Client();
    const { handle } = await emailCaller(c);
    const id = await userIdFor(handle);

    await maybeTriggerGrowthLoop(id);
    await recordLoopCodeCreated(id);
    const [u] = await db().select().from(schema.users).where(eq(schema.users.id, id));
    expect(u.loopPrompt).toBeNull();
    const e = await db().select().from(schema.auditEvents).where(eq(schema.auditEvents.type, "growth.loop_code_created" as any));
    expect(e.length).toBe(1);
  });
});
