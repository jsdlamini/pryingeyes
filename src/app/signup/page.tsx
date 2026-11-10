"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, errMsg } from "@/components/api";
import { HandleField } from "@/components/HandleField";
import { Icon } from "@/components/Icon";

/** One way in: email and password. If they came from a code or invite, they return to it after confirming. */
export default function Signup() {
  const [next, setNext] = useState<string | null>(null);
  useEffect(() => { const n = new URLSearchParams(window.location.search).get("next"); if (n?.startsWith("/") && !n.startsWith("//")) setNext(n); }, []);
  const [form, setForm] = useState({ email: "", password: "", handle: "", ageConfirmed: false });
  const [err, setErr] = useState(""); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  const setHandle = useCallback((handle: string) => setForm((f) => ({ ...f, handle })), []);
  const [handleOk, setHandleOk] = useState(true);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await api("/api/auth/signup", { body: { ...form, next } }); setSent(true); }
    catch (x: any) { if (x?.body?.suggestion) setHandle(x.body.suggestion); setErr(errMsg(x)); }
    finally { setBusy(false); }
  }
  return (
    <div className="narrow">
      <h1>Create your account</h1>
      <p className="muted small">People will know you by your handle. Your email is never shown to anyone.</p>
      <div className="card">
        {sent ? (
          <div role="status">
            <h2>Check your email</h2>
            <p>We sent a confirmation link to <b>{form.email}</b>. It expires in 24 hours.{next ? " After confirming, you'll come straight back here." : ""}</p>
            <p className="muted small">Running locally? Open <a href="/dev/outbox">the development outbox</a> to see it.</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            {err && <div className="alert err" role="alert">{err}</div>}
            <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
            <div className="field"><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="new-password" minLength={10} required value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} /><p className="hint">At least 10 characters. A short sentence works well.</p></div>
            <HandleField value={form.handle} onChange={setHandle} onValidity={setHandleOk} />
            <label className="check field"><input type="checkbox" checked={form.ageConfirmed} onChange={(e) => setForm((f) => ({ ...f, ageConfirmed: e.target.checked }))} /> <span>I'm 18 or older and accept the <a href="/privacy" target="_blank">privacy notice</a>.</span></label>
            <button className="btn block social" disabled={busy || !form.ageConfirmed || !handleOk}><Icon name="mail" size={18} />Create account</button>
          </form>
        )}
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>Already have an account? <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>Sign in</Link></p>
    </div>
  );
}
