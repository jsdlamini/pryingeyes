"use client";
import { useEffect, useState } from "react";
import { api, errMsg } from "@/components/api";
import { passkeysSupported, authenticateWithPasskey } from "@/components/passkey";

const nextUrl = () => { const n = new URLSearchParams(window.location.search).get("next"); return n?.startsWith("/") && !n.startsWith("//") ? n : "/dashboard"; };

export default function Mfa() {
  // Passkey support is decided after mount: knowing it during the first render would
  // make the server HTML differ from the client tree and force a full re-hydration.
  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => { setCanPasskey(passkeysSupported()); }, []);
  const [code, setCode] = useState(""); const [rc, setRc] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"main" | "recovery" | "cooldown">("main");
  const [availableAt, setAvailableAt] = useState<string | null>(null);

  async function totp(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await api("/api/auth/mfa/totp", { body: { code } }); window.location.href = nextUrl(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  async function passkey() {
    setBusy(true); setErr("");
    try { await authenticateWithPasskey(); window.location.href = nextUrl(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  async function recovery(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { const r = await api("/api/auth/recovery/start", { body: { code: rc } }); setAvailableAt(r.availableAt); setMode("cooldown"); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  async function complete() {
    setBusy(true); setErr("");
    try { await api("/api/auth/recovery/complete", { body: {} }); window.location.href = "/onboarding"; } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <div className="narrow">
      <h1>Two-step sign-in</h1>
      <div className="card stack">
        {err && <div className="alert err" role="alert">{err}</div>}
        {mode === "main" && <>
          {canPasskey && <button className="btn block accent" onClick={passkey} disabled={busy}>Use my passkey</button>}
          <form onSubmit={totp}>
            <label htmlFor="code">Code from your authenticator app</label>
            <input id="code" className="otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            <button className="btn block" style={{ marginTop: 10 }} disabled={busy || code.length !== 6}>Continue</button>
          </form>
          <button className="linkbtn small" onClick={() => setMode("recovery")}>Lost your device? Use a recovery code</button>
        </>}
        {mode === "recovery" && <form onSubmit={recovery}>
          <div className="alert info">Using a recovery code starts a <b>24-hour waiting period</b>. Every device you're signed in on is told, so the real you can cancel it if this isn't you.</div>
          <label htmlFor="rc">Recovery code</label>
          <input id="rc" type="text" className="mono" autoComplete="off" value={rc} onChange={(e) => setRc(e.target.value)} placeholder="XXXXX-XXXXX" />
          <div className="row" style={{ marginTop: 10 }}><button className="btn" disabled={busy || rc.length < 10}>Start recovery</button><button type="button" className="btn ghost" onClick={() => setMode("main")}>Back</button></div>
        </form>}
        {mode === "cooldown" && <div role="status">
          <h2>Recovery started</h2>
          <p>You can finish after <b>{availableAt && new Date(availableAt).toLocaleString()}</b>. Then you'll set up a new passkey or authenticator app.</p>
          <button className="btn" onClick={complete} disabled={busy}>Finish recovery</button>
        </div>}
      </div>
    </div>
  );
}
