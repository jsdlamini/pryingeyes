"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, errMsg } from "@/components/api";
import { passkeysSupported, registerPasskey } from "@/components/passkey";
import { TotpSetup } from "@/components/TotpSetup";
import { RecoveryCodes } from "@/components/RecoveryCodes";
import { PhoneInput, initialPhone, phoneBody, phoneValid, type PhoneValue } from "@/components/PhoneInput";

type Me = { user: any; owner: { verified: boolean; ageConfirmed: boolean; mfa: boolean; sessionMfa: boolean } };

export default function Onboarding() {
  const [me, setMe] = useState<Me | null>(null);
  const [numbers, setNumbers] = useState<any[] | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState<PhoneValue>({ country: "SZ", number: "" }); const [label, setLabel] = useState("Personal mobile");

  const load = useCallback(async () => {
    const m = await api<Me>("/api/me"); setMe(m);
    if (m.owner.mfa && m.owner.sessionMfa) setNumbers((await api("/api/numbers")).numbers);
  }, []);
  useEffect(() => { setPhone(initialPhone()); load().catch((e) => setErr(errMsg(e))); }, [load]);

  async function passkey() {
    setBusy(true); setErr("");
    try { const r = await registerPasskey("Passkey"); if (r.recoveryCodes) setCodes(r.recoveryCodes); await load(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  async function addNumber(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await api("/api/numbers", { body: { ...phoneBody(phone), label } }); setPhone({ ...phone, number: "" }); await load(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  if (!me) return <div className="narrow"><p>Loading…</p>{err && <div className="alert err">{err}</div>}</div>;
  const mfaDone = me.owner.mfa;
  const step = (n: number, done: boolean, title: string) => (
    <h2 className="spread"><span>{n}. {title}</span>{done && <span className="status good">Done</span>}</h2>
  );
  return (
    <div className="narrow" style={{ maxWidth: 640 }}>
      <h1>Add a phone number</h1>
      <p className="muted">Optional. Codes work without one: people message and call you in the app. Adding a number lets people you approve see it once, as a watermarked image. Because a number is stored, two-step sign-in comes first.</p>
      {err && <div className="alert err" role="alert">{err}</div>}
      <div className="card">{step(1, me.owner.verified, "Account verified")}
        {!me.owner.verified && <p className="muted small">Confirm your email or phone first.</p>}
      </div>
      <div className="card">
        {step(2, mfaDone, "Set up two-step sign-in")}
        {codes ? <RecoveryCodes codes={codes} onDone={() => setCodes(null)} /> : !mfaDone ? (
          <div className="stack">
            {passkeysSupported() && <><button className="btn accent" onClick={passkey} disabled={busy}>Create a passkey (recommended)</button>
              <p className="hint">Uses your phone's or computer's screen lock. Nothing to type, and it can't be phished.</p></>}
            <TotpSetup onDone={async (c) => { if (c) setCodes(c); await load(); }} />
          </div>
        ) : <p className="muted small">You're set. Manage factors any time in <Link href="/settings">Settings</Link>.</p>}
      </div>
      <div className="card">
        {step(3, !!numbers?.length, "Add your number")}
        {mfaDone && !codes ? (
          <>
            {numbers?.map((n) => <p key={n.id} className="small">Added: {n.label || "Number"} ending ··{n.hint}</p>)}
            <form onSubmit={addNumber}>
              <PhoneInput id="num" label="Phone number" value={phone} onChange={setPhone} autoComplete="off"
                hint="It's encrypted as soon as it arrives and only shown to people you allow, as a watermarked image." />
              <div className="field"><label htmlFor="lbl">Name for this number (only you see it)</label><input id="lbl" type="text" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} /></div>
              <button className="btn" disabled={busy || !phoneValid(phone)}>Add number</button>
            </form>
          </>
        ) : <p className="muted small">Available after step 2.</p>}
      </div>
      {numbers && numbers.length > 0 && <div className="card spread"><span>Done. New codes can now use this number.</span><Link className="btn accent" href="/dashboard">Back to my codes</Link></div>}
    </div>
  );
}
