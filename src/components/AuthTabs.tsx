"use client";
import { useEffect, useState } from "react";
import { api, errMsg } from "@/components/api";
import { passkeysSupported, authenticateWithPasskey } from "@/components/passkey";
import { HandleField } from "@/components/HandleField";
import { Icon } from "@/components/Icon";
import { CodeEntry } from "@/components/CodeEntry";

const nextUrl = () => {
  const n = new URLSearchParams(window.location.search).get("next");
  return n?.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
};
function after(status: string) {
  window.location.href = status === "mfa_required" ? `/login/mfa?next=${encodeURIComponent(nextUrl())}` : nextUrl();
}

export function AuthTabs({ initialTab = "signin" }: { initialTab?: "signin" | "signup" | "reach" }) {
  const [tab, setTab] = useState<"signin" | "signup" | "reach">(initialTab);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  // Passkey support is only known once the page runs in a browser. Deciding it during the first
  // render would make the server HTML differ from the client tree (the passkey button appearing
  // mid-hydration), which forces React to throw the whole page away and rebuild it.
  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => { setCanPasskey(passkeysSupported()); }, []);
  useEffect(() => { setTab(initialTab === "signup" || initialTab === "reach" ? initialTab : "signin"); }, [initialTab]);
  // sign-in
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [showPw, setShowPw] = useState(false);
  // sign-up
  const [se, setSe] = useState(""); const [sp, setSp] = useState(""); const [sh, setSh] = useState("");
  const [sa, setSa] = useState(false); const [sent, setSent] = useState(false); const [handleOk, setHandleOk] = useState(true); const [showSp, setShowSp] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { after((await api("/api/auth/login", { body: { email, password } })).status); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  async function passkey() {
    setErr(""); setBusy(true);
    try { after((await authenticateWithPasskey()).status); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  async function signUp(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await api("/api/auth/signup", { body: { email: se, password: sp, handle: sh, ageConfirmed: sa, next: nextUrl() } }); setSent(true); }
    catch (x: any) { if (x?.body?.suggestion) setSh(x.body.suggestion); setErr(errMsg(x)); } finally { setBusy(false); }
  }

  return (
    <div className="auth-card">
      <div className="auth-tabs" role="tablist" aria-label="Account">
        <button type="button" role="tab" aria-selected={tab === "signin"} className={tab === "signin" ? "on" : ""} onClick={() => { setTab("signin"); setErr(""); }}>Sign in</button>
        <button type="button" role="tab" aria-selected={tab === "signup"} className={tab === "signup" ? "on" : ""} onClick={() => { setTab("signup"); setErr(""); }}>Create account</button>
        <button type="button" role="tab" aria-selected={tab === "reach"} className={tab === "reach" ? "on" : ""} onClick={() => { setTab("reach"); setErr(""); }}>Reach someone</button>
      </div>
      {err && <div className="alert err" role="alert">{err}</div>}

      {tab === "reach" ? (
        <CodeEntry />
      ) : tab === "signin" ? (
        <div className="stack">
          <form onSubmit={signIn} className="stack">
            <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="field"><label htmlFor="password">Password</label><div className="pw-wrap"><input id="password" type={showPw ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" className="pw-toggle" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={showPw} title={showPw ? "Hide password" : "Show password"}><Icon name={showPw ? "eyeOff" : "eye"} size={18} /></button></div></div>
            <button className="btn block" disabled={busy}>Sign in</button>
          </form>
          {canPasskey && (
            <>
              <div className="pw-divider" role="separator"><span>or</span></div>
              <button type="button" className="btn block social" onClick={passkey} disabled={busy}><Icon name="key" size={18} />Sign in with a passkey</button>
            </>
          )}
        </div>
      ) : sent ? (
        <div role="status">
          <h2>Check your email</h2>
          <p>We sent a confirmation link to <b>{se}</b>. It expires in 24 hours.</p>
        </div>
      ) : (
        <form onSubmit={signUp} className="stack">
          <div className="field"><label htmlFor="se">Email</label><input id="se" type="email" autoComplete="email" required value={se} onChange={(e) => setSe(e.target.value)} /></div>
          <div className="field"><label htmlFor="sp">Password</label><div className="pw-wrap"><input id="sp" type={showSp ? "text" : "password"} autoComplete="new-password" minLength={10} required value={sp} onChange={(e) => setSp(e.target.value)} /><button type="button" className="pw-toggle" onClick={() => setShowSp((v) => !v)} aria-label={showSp ? "Hide password" : "Show password"} aria-pressed={showSp} title={showSp ? "Hide password" : "Show password"}><Icon name={showSp ? "eyeOff" : "eye"} size={18} /></button></div><p className="hint">At least 10 characters. A short sentence works well.</p></div>
          <HandleField value={sh} onChange={setSh} onValidity={setHandleOk} />
          <label className="check field"><input type="checkbox" checked={sa} onChange={(e) => setSa(e.target.checked)} /> <span>I&apos;m 18 or older and accept the <a href="/privacy" target="_blank">privacy notice</a>.</span></label>
          <button className="btn block" disabled={busy || !sa || !handleOk}>Create account</button>
        </form>
      )}
    </div>
  );
}
