import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
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

/** Silently adopts a different detected country as home after it has been seen for 14 days. */
export async function maybeRefreshHomeCountry(userId: string, country: string): Promise<void> {
  const [u] = await db().select({ homeCountry: schema.users.homeCountry, placesSource: schema.users.placesSource, seenCountry: schema.users.seenCountry, seenSince: schema.users.seenSince })
    .from(schema.users).where(eq(schema.users.id, userId));
  if (!u || u.placesSource !== "detected") return;
  if (!country || country.length !== 2 || country === u.homeCountry) {
    if (u.seenCountry) await db().update(schema.users).set({ seenCountry: null, seenSince: null }).where(eq(schema.users.id, userId));
    return;
  }
  if (u.seenCountry !== country) {
    await db().update(schema.users).set({ seenCountry: country, seenSince: new Date() }).where(eq(schema.users.id, userId));
    return;
  }
  if (u.seenSince && Date.now() - u.seenSince.getTime() >= 14 * 86400_000) {
    await db().update(schema.users).set({ homeCountry: country, homeRegion: null, seenCountry: null, seenSince: null }).where(eq(schema.users.id, userId));
  }
}
