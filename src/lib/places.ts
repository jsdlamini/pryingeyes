import { env } from "./env";

/** Known region names/codes per country. Cloudflare sends `cf-region-code` (ISO 3166-2, e.g. SZ-HH)
 *  or `cf-region` (the plain name). Other countries get no region until they're added here. */
const KNOWN_REGIONS: Record<string, Record<string, string>> = {
  SZ: {
    "SZ-HH": "Hhohho", "SZ-MA": "Manzini", "SZ-LU": "Lubombo", "SZ-SH": "Shiselweni",
    Hhohho: "Hhohho", Manzini: "Manzini", Lubombo: "Lubombo", Shiselweni: "Shiselweni",
  },
};

function regionFor(country: string, code: string | null): string | null {
  if (!code) return null;
  const known = KNOWN_REGIONS[country];
  if (!known) return null;
  const c = code.trim();
  if (known[c]) return known[c];
  if (c.toUpperCase().startsWith(country.toUpperCase() + "-")) {
    const suffix = c.slice(3);
    if (known[suffix]) return known[suffix];
  }
  return null;
}

/** The visitor's country and region from Cloudflare headers only. Never from the device. */
export function placesFromRequest(req: Request): { country: string; region: string | null } {
  const raw = (req.headers.get("cf-ipcountry") ?? "").trim().toUpperCase();
  const country = raw === "XX" || raw === "T1" || raw.length !== 2 ? env().DEFAULT_COUNTRY : raw;
  const code = req.headers.get("cf-region-code") ?? req.headers.get("cf-region") ?? null;
  return { country, region: regionFor(country, code) };
}

/** The person's countries: home country plus any extras they chose. */
export function personCountries(u: { home_country?: string | null; extra_countries?: string[] | null }): string[] {
  return [...new Set([u.home_country ?? env().DEFAULT_COUNTRY, ...(u.extra_countries ?? [])])].filter(Boolean);
}
