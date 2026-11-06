"use client";
import { useState } from "react";
import { api, errMsg } from "./api";

export function TotpSetup({ onDone }: { onDone: (recoveryCodes: string[] | null) => void }) {
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function begin() {
    setBusy(true); setErr("");
    try { setSetup(await api("/api/auth/totp/setup", { body: {} })); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  async function confirm(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { const r = await api("/api/auth/totp/confirm", { body: { code } }); onDone(r.recoveryCodes); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  if (!setup) return <><button className="btn ghost" onClick={begin} disabled={busy}>Use an authenticator app instead</button>{err && <div className="alert err">{err}</div>}</>;
  return (
    <form onSubmit={confirm} className="stack">
      {err && <div className="alert err" role="alert">{err}</div>}
      <p className="small">Scan this with Google Authenticator, Microsoft Authenticator, Aegis or similar.</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} style={{ background: "#fff", padding: 6, borderRadius: 8 }} />
      <p className="small muted">Can't scan? Enter this key: <code>{setup.secret}</code></p>
      <label htmlFor="totp-code">Enter the 6-digit code it shows</label>
      <input id="totp-code" className="otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
      <button className="btn" disabled={busy || code.length !== 6}>Confirm</button>
    </form>
  );
}
