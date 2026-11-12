import { describe, expect, it } from "vitest";
import { countryLabel, flagEmoji } from "@/lib/countries";

describe("flagEmoji", () => {
  it("builds regional-indicator flags", () => {
    expect(flagEmoji("SZ")).toBe("🇸🇿");
    expect(flagEmoji("za")).toBe("🇿🇦");
  });
  it("is empty for invalid codes", () => {
    expect(flagEmoji("S")).toBe("");
    expect(flagEmoji("S1")).toBe("");
    expect(flagEmoji("")).toBe("");
  });
});

describe("countryLabel", () => {
  it("shows flag, full name and code", () => {
    expect(countryLabel("SZ")).toBe("🇸🇿 Eswatini (SZ)");
    expect(countryLabel("ZA")).toBe("🇿🇦 South Africa (ZA)");
  });
  it("falls back to flag + code when the name is unknown", () => {
    expect(countryLabel("XX")).toBe("🇽🇽 XX");
  });
  it("is empty for a blank code", () => {
    expect(countryLabel("")).toBe("");
  });
});
