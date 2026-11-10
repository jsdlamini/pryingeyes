"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, errMsg, registerStepUp } from "./api";
import { passkeysSupported, authenticateWithPasskey } from "./passkey";

const Ctx = createContext<() => Promise<boolean>>(async () => false);
export const useStepUp = () => useContext(Ctx);

/** "Confirm it's you" dialog, used automatically when the server asks for a fresh second factor. */
export function StepUpProvider({ children }: { children: React.ReactNode }) {
  // Passkey support is decided after mount: knowing it during the first render would
  // make the server HTML differ from the client tree and force a full re-hydration.
  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => { setCanPasskey(passkeysSupported()); }, []);
  const ref = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const open = useCallback(() => new Promise<boolean>((resolve) => {
    resolver.current = resolve; setCode(""); setErr("");
    ref.current?.showModal();
  }), []);
  useEffect(() => { registerStepUp(open); return () => registerStepUp(null); }, [open]);

  const finish = (ok: boolean) => { ref.current?.close(); resolver.current?.(ok); resolver.current = null; };
  async function withCode(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await api("/api/auth/mfa/totp", { body: { code }, retry: false }); finish(true); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  async function withPasskey() {
    setBusy(true); setErr("");
    try { await authenticateWithPasskey(); finish(true); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <Ctx.Provider value={open}>
      {children}
      <dialog ref={ref} aria-labelledby="stepup-title" onCancel={() => finish(false)}>
        <h2 id="stepup-title">Confirm it's you</h2>
        <p className="muted small">This action needs a fresh check of your second factor.</p>
        {err && <div className="alert err" role="alert">{err}</div>}
        {canPasskey && <button className="btn block" onClick={withPasskey} disabled={busy}>Use my passkey</button>}
        <form onSubmit={withCode} style={{ marginTop: 12 }}>
          <label htmlFor="stepup-code">Or enter the 6-digit code from your authenticator app</label>
          <input id="stepup-code" type="text" inputMode="numeric" autoComplete="one-time-code" className="otp" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" disabled={busy || code.length !== 6}>Confirm</button>
            <button type="button" className="btn ghost" onClick={() => finish(false)}>Cancel</button>
          </div>
        </form>
      </dialog>
    </Ctx.Provider>
  );
}
