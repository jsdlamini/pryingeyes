"use client";
import { useEffect, useMemo, useState } from "react";
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";

/** Value sent to the API: the national number as typed plus the selected ISO country (e.g. "SZ"). */
export interface PhoneValue { country: string; number: string }

const PRIORITY = ["SZ", "ZA", "BW", "MZ", "LS", "NA", "ZW", "ZM", "MW", "KE", "NG", "GB", "US"];
const DEFAULT_COUNTRY = "SZ";
const STORE_KEY = "pe.phoneCountry";

const flag = (cc: string) => String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

function regionNames() {
  try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; }
}

export function initialPhone(): PhoneValue {
  let country = DEFAULT_COUNTRY;
  try { const s = window.localStorage.getItem(STORE_KEY); if (s && getCountries().includes(s as CountryCode)) country = s; } catch { /* storage unavailable */ }
  return { country, number: "" };
}

/** True when the number is a valid phone number for the selected country (or a valid +international number). */
export function phoneValid(v: PhoneValue): boolean {
  const n = v.number.trim().replace(/^00(?=[1-9])/, "+");
  if (n.replace(/\D/g, "").length < 4) return false;
  try { return !!parsePhoneNumberFromString(n, v.country as CountryCode)?.isValid(); } catch { return false; }
}

/** Request body fields for the phone APIs. */
export const phoneBody = (v: PhoneValue) => ({ phone: v.number.trim(), country: v.country });

/**
 * Country picker + national number. Pasting a full international number ("+27 82 …") switches the
 * country automatically and keeps just the national part, so nobody has to type a dialling code.
 */
export function PhoneInput({ id, label, value, onChange, hint, autoComplete = "tel-national" }: {
  id: string; label: string; value: PhoneValue; onChange: (v: PhoneValue) => void; hint?: React.ReactNode; autoComplete?: string;
}) {
  const [touched, setTouched] = useState(false);
  const options = useMemo(() => {
    const names = regionNames();
    const all = getCountries().map((cc) => ({ cc, name: names?.of(cc) ?? cc, dial: getCountryCallingCode(cc) }));
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    const top = PRIORITY.map((cc) => all.find((o) => o.cc === cc)!).filter(Boolean);
    const rest = all.filter((o) => !PRIORITY.includes(o.cc)).sort(byName);
    return { top, rest };
  }, []);

  useEffect(() => { try { window.localStorage.setItem(STORE_KEY, value.country); } catch { /* ignore */ } }, [value.country]);

  function setNumber(raw: string) {
    const clean = raw.replace(/[^\d+\s()\-.]/g, "").slice(0, 24);
    const intl = clean.trim().replace(/^00(?=[1-9])/, "+");
    if (intl.startsWith("+")) {
      const p = parsePhoneNumberFromString(intl);
      if (p?.country && p.isPossible()) { onChange({ country: p.country, number: p.formatNational() }); return; }
    }
    onChange({ ...value, number: clean });
  }

  const dial = getCountryCallingCode(value.country as CountryCode);
  const example = value.country === "SZ" ? "7612 3456" : value.country === "ZA" ? "082 123 4567" : value.country === "GB" ? "07400 123456" : "";
  const bad = touched && value.number.trim().length > 0 && !phoneValid(value);
  const countryName = [...options.top, ...options.rest].find((o) => o.cc === value.country)?.name ?? value.country;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="phone-row">
        <select aria-label="Country" id={`${id}-country`} value={value.country} onChange={(e) => onChange({ ...value, country: e.target.value })}>
          <optgroup label="Common">{options.top.map((o) => <option key={o.cc} value={o.cc}>{flag(o.cc)} {o.name} (+{o.dial})</option>)}</optgroup>
          <optgroup label="All countries">{options.rest.map((o) => <option key={o.cc} value={o.cc}>{flag(o.cc)} {o.name} (+{o.dial})</option>)}</optgroup>
        </select>
        <span className="phone-dial" aria-hidden="true">+{dial}</span>
        <input id={id} type="tel" inputMode="tel" autoComplete={autoComplete} placeholder={example} value={value.number}
          aria-invalid={bad || undefined} aria-describedby={`${id}-hint`}
          onChange={(e) => setNumber(e.target.value)} onBlur={() => setTouched(true)} />
      </div>
      <p className="hint" id={`${id}-hint`}>
        {bad ? <span className="bad">That doesn't look like a {countryName} number. Check the digits or pick another country.</span>
          : <>Pick the country, then type the number without the +{dial} code.{hint ? <> {hint}</> : null}</>}
      </p>
    </div>
  );
}
