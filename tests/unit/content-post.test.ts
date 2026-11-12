import { describe, expect, it } from "vitest";
import { buildPostText } from "@/lib/content";

describe("buildPostText", () => {
  it("joins the summary, source link and deadline", () => {
    const text = buildPostText({
      summary: "A two-year graduate trainee programme at a bank.",
      body: "ignored", url: "https://example.gov.sz/jobs/1",
      deadline: new Date("2026-12-31T23:59:59Z"),
    } as never);
    expect(text).toContain("graduate trainee programme");
    expect(text).toContain("Source: https://example.gov.sz/jobs/1");
    expect(text).toContain("Apply by: 2026-12-31");
  });
  it("falls back to the raw body when there is no summary", () => {
    const text = buildPostText({ summary: null, body: "Raw notice text", url: "", deadline: null } as never);
    expect(text).toBe("Raw notice text");
  });
  it("omits the source and deadline lines when absent", () => {
    const text = buildPostText({ summary: "Just a summary.", body: "", url: "", deadline: null } as never);
    expect(text).toBe("Just a summary.");
    expect(text).not.toContain("Source:");
    expect(text).not.toContain("Apply by:");
  });
});
