import { describe, expect, it } from "vitest";
import { personCountries, placesFromRequest } from "@/lib/places";

function req(headers: Record<string, string>) {
  return new Request("https://pryingeyes.idealsoftwaresolutions.com", { headers });
}

describe("placesFromRequest", () => {
  it("uses CF-IPCountry and cf-region-code", () => {
    expect(placesFromRequest(req({ "cf-ipcountry": "SZ", "cf-region-code": "SZ-MA" }))).toEqual({ country: "SZ", region: "Manzini" });
  });
  it("maps the plain region name", () => {
    expect(placesFromRequest(req({ "cf-ipcountry": "SZ", "cf-region": "Lubombo" }))).toEqual({ country: "SZ", region: "Lubombo" });
  });
  it("falls back to DEFAULT_COUNTRY with no header", () => {
    const p = placesFromRequest(req({}));
    expect(p.country).toBe("SZ");
    expect(p.region).toBeNull();
  });
  it("ignores XX and T1", () => {
    expect(placesFromRequest(req({ "cf-ipcountry": "XX" })).country).toBe("SZ");
    expect(placesFromRequest(req({ "cf-ipcountry": "T1" })).country).toBe("SZ");
  });
  it("ignores an unknown region code", () => {
    expect(placesFromRequest(req({ "cf-ipcountry": "SZ", "cf-region-code": "SZ-XX" })).region).toBeNull();
  });
  it("keeps another country with no region", () => {
    expect(placesFromRequest(req({ "cf-ipcountry": "ZA" }))).toEqual({ country: "ZA", region: null });
  });
});

describe("personCountries", () => {
  it("returns home plus extras, deduped", () => {
    expect(personCountries({ home_country: "SZ", extra_countries: ["ZA", "SZ", "MZ"] })).toEqual(["SZ", "ZA", "MZ"]);
  });
  it("falls back to DEFAULT_COUNTRY when empty", () => {
    expect(personCountries({ home_country: null, extra_countries: [] })).toEqual(["SZ"]);
  });
  it("caps at home plus three extras", () => {
    expect(personCountries({ home_country: "SZ", extra_countries: ["ZA", "MZ", "BW"] })).toHaveLength(4);
  });
});
