/** Flag emoji for an ISO 3166-1 alpha-2 code ("" for anything invalid). */
export function flagEmoji(code: string): string {
  const c = (code ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  return String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65, 0x1f1e6 + c.charCodeAt(1) - 65);
}

/** Common country names. Codes not listed here just show their flag + code. */
export const COUNTRY_NAMES: Record<string, string> = {
  SZ: "Eswatini", ZA: "South Africa", MZ: "Mozambique", BW: "Botswana", LS: "Lesotho", ZW: "Zimbabwe",
  NA: "Namibia", ZM: "Zambia", MW: "Malawi", TZ: "Tanzania", KE: "Kenya", UG: "Uganda", RW: "Rwanda",
  BI: "Burundi", CD: "DR Congo", CG: "Congo", AO: "Angola", MG: "Madagascar", MU: "Mauritius", SC: "Seychelles",
  KM: "Comoros", ET: "Ethiopia", SD: "Sudan", SS: "South Sudan", SO: "Somalia", DJ: "Djibouti", ER: "Eritrea",
  EG: "Egypt", LY: "Libya", TN: "Tunisia", DZ: "Algeria", MA: "Morocco", MR: "Mauritania", ML: "Mali",
  NE: "Niger", TD: "Chad", NG: "Nigeria", GH: "Ghana", CI: "Côte d'Ivoire", SN: "Senegal", GM: "Gambia",
  GW: "Guinea-Bissau", GN: "Guinea", SL: "Sierra Leone", LR: "Liberia", TG: "Togo", BJ: "Benin", BF: "Burkina Faso",
  CM: "Cameroon", GA: "Gabon", GQ: "Equatorial Guinea", CF: "Central African Republic", ST: "São Tomé and Príncipe", CV: "Cabo Verde",
  GB: "United Kingdom", US: "United States", CA: "Canada", AU: "Australia", NZ: "New Zealand", IE: "Ireland",
  DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", PT: "Portugal", NL: "Netherlands", BE: "Belgium", CH: "Switzerland",
  AE: "United Arab Emirates", SA: "Saudi Arabia", QA: "Qatar", KW: "Kuwait", BH: "Bahrain", OM: "Oman",
  IN: "India", CN: "China", JP: "Japan", KR: "South Korea", SG: "Singapore", MY: "Malaysia", ID: "Indonesia", TH: "Thailand", PH: "Philippines", PK: "Pakistan", BD: "Bangladesh",
};

/** "🇸🇿 Eswatini (SZ)" for display; falls back to the bare code when unknown. */
export function countryLabel(code: string): string {
  const c = (code ?? "").toUpperCase();
  if (!c) return "";
  const name = COUNTRY_NAMES[c];
  const flag = flagEmoji(c);
  return name ? `${flag} ${name} (${c})` : (flag ? `${flag} ${c}` : c);
}
