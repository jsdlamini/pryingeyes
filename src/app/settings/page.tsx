"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg, relTime } from "@/components/api";
import { passkeysSupported, registerPasskey } from "@/components/passkey";
import { TotpSetup } from "@/components/TotpSetup";
import { RecoveryCodes } from "@/components/RecoveryCodes";
import { Icon } from "@/components/Icon";

export default function Settings() {
  // Passkey support is decided after mount: knowing it during the first render would
  // make the server HTML differ from the client tree and force a full re-hydration.
  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => { setCanPasskey(passkeysSupported()); }, []);
  const [me, setMe] = useState<any>(null); const [sessions, setSessions] = useState<any[]>([]); const [notes, setNotes] = useState<any[]>([]);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [pw, setPw] = useState({ current: "", password: "" });
  const [confirmText, setConfirmText] = useState("");
  const load = useCallback(async () => {
    const m = await api("/api/me"); setMe(m);
    setSessions((await api("/api/auth/sessions")).sessions);
    const n = await api("/api/notifications"); setNotes(n.notifications);
    if (n.unread) await api("/api/notifications", { body: {} });
  }, []);
  useEffect(() => { load().catch((e) => setErr(errMsg(e))); }, [load]);
  const run = async (fn: () => Promise<unknown>, ok?: string) => { setErr(""); setMsg(""); try { await fn(); if (ok) setMsg(ok); await load(); } catch (x) { setErr(errMsg(x)); } };
  if (!me) return <div className="page">{err ? <div className="alert err">{err}</div> : <p>Loading…</p>}</div>;
  const u = me.user;
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1>Settings</h1>
      {err && <div className="alert err" role="alert">{err}</div>}
      {msg && <div className="alert ok" role="status">{msg}</div>}
      {u.recovery && <div className="alert warn spread"><span>Account recovery is in progress and completes {relTime(u.recovery.availableAt)}. If this wasn't you, cancel it now.</span>
        <button className="btn danger sm" onClick={() => run(() => api("/api/auth/recovery/cancel", { body: {} }), "Recovery cancelled.")}>Cancel recovery</button></div>}

      <div className="card">
        <h2>Account</h2>
        <p>@{u.handle}{u.email ? <> · {u.email} {u.emailVerified ? <span className="status good">verified</span> : <span className="status pending">unverified</span>}</> : null}</p>
      </div>

      <div className="card stack">
        <h2>Show my number (optional)</h2>
        <p className="small muted">Your codes work without a phone number: people message and call you in the app. If you want, add a number so that people who pass a code&apos;s checks can see it once, as a watermarked image.</p>
        <p><a className="btn ghost sm" href="/dashboard/numbers">Manage numbers</a></p>
      </div>

      <div className="card stack">
        <h2>Two-step sign-in</h2>
        {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}
        <div>
          <b>Passkeys</b>
          {u.passkeys.length === 0 ? <p className="muted small">None yet.</p> : <ul>{u.passkeys.map((p: any) => (
            <li key={p.id} className="spread small"><span>{p.name} · added {relTime(p.createdAt)}{p.lastUsedAt ? ` · used ${relTime(p.lastUsedAt)}` : ""}</span>
              <button className="iconbtn sm danger" onClick={() => run(() => api(`/api/auth/passkey/${encodeURIComponent(p.id)}`, { method: "DELETE" }), "Passkey removed.")} aria-label={`Remove ${p.name}`} title="Remove"><Icon name="trash" size={16} /></button></li>))}</ul>}
          {canPasskey && <button className="btn ghost sm" onClick={() => run(async () => { const r = await registerPasskey("Passkey"); if (r.recoveryCodes) setCodes(r.recoveryCodes); }, "Passkey added.")}><Icon name="key" size={16} />Add a passkey</button>}
        </div>
        <div><b>Authenticator app</b> {u.totp ? <span className="status good">on</span> : <TotpSetup onDone={async (c) => { if (c) setCodes(c); await load(); }} />}</div>
        {(u.totp || u.passkeys.length > 0) && <div><b>Recovery codes</b> <span className="muted small">{u.recoveryCodesLeft} left</span>{" "}
          <button className="btn ghost sm" onClick={() => run(async () => setCodes((await api("/api/auth/recovery-codes", { body: {} })).recoveryCodes))}>Make new codes</button></div>}
      </div>

      <form className="card" onSubmit={(e) => { e.preventDefault(); run(() => api("/api/auth/password", { body: pw }), "Password changed. Other devices were signed out."); setPw({ current: "", password: "" }); }}>
        <h2>{u.hasPassword ? "Change password" : "Set a password"}</h2>
        <div className="grid2">
          {u.hasPassword && <div className="field"><label htmlFor="cur">Current password</label><input id="cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /><p className="hint">Or leave empty and confirm with your passkey/authenticator.</p></div>}
          <div className="field"><label htmlFor="np">New password</label><input id="np" type="password" autoComplete="new-password" minLength={10} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></div>
        </div>
        <button className="btn ghost sm" disabled={pw.password.length < 10}>Save password</button>
      </form>

      <div className="card">
        <h2>Signed-in devices</h2>
        <table className="tbl"><tbody>{sessions.map((s) => (
          <tr key={s.id}><td>{s.deviceLabel}{s.current && <span className="status good" style={{ marginLeft: 6 }}>this device</span>}</td><td className="muted small">active {relTime(s.lastSeenAt)}</td>
            <td>{!s.current && <button className="btn ghost sm" onClick={() => run(() => api(`/api/auth/sessions/${s.id}`, { method: "DELETE" }), "Device signed out.")}><Icon name="logout" size={16} />Sign out</button>}</td></tr>))}</tbody></table>
      </div>

      <div className="card stack">
        <h2>Places</h2>
        <p className="muted small" style={{ margin: 0 }}>Detected automatically from your connection. Change it if you'd like.</p>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="hc">Country</label>
          <select id="hc" value={u.homeCountry ?? "SZ"} onChange={(e) => run(() => api("/api/me/settings", { method: "PATCH", body: { homeCountry: e.target.value, placesSource: "chosen" } }), "Saved.")}>
            {["SZ", "ZA", "MZ", "BW", "LS", "ZW", "NA", "ZM"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="hr">Region</label>
          <select id="hr" value={u.homeRegion ?? ""} onChange={(e) => run(() => api("/api/me/settings", { method: "PATCH", body: { homeRegion: e.target.value || null, placesSource: "chosen" } }), "Saved.")}>
            <option value="">Whole country</option>
            {["Hhohho", "Manzini", "Lubombo", "Shiselweni"].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <p className="muted tiny" style={{ margin: 0 }}>{u.placesSource === "detected" ? `Showing ${u.homeCountry ?? "SZ"}${u.homeRegion ? ` · ${u.homeRegion}` : ""} — detected automatically.` : "You chose these places."}</p>
        <button className="btn ghost sm" onClick={() => run(() => api("/api/me/settings", { method: "PATCH", body: { placesSource: "detected" } }), "Saved.")} style={{ alignSelf: "flex-start" }}>Use detected location</button>
      </div>
      <div className="card">
        <h2>Privacy</h2>
        <div className="grid2">
          <div className="field"><label htmlFor="ret">Keep my audit trail for</label>
            <select id="ret" value={u.auditRetentionMonths} onChange={(e) => run(() => api("/api/me/settings", { method: "PATCH", body: { auditRetentionMonths: Number(e.target.value) } }), "Saved.")}>
              {[1, 3, 6, 12, 18, 24].map((m) => <option key={m} value={m}>{m} month{m > 1 ? "s" : ""}</option>)}</select>
            <p className="hint">It's both a safety record and data about the people who contacted you.</p></div>
          <label className="check"><input type="checkbox" checked={u.readReceipts} onChange={(e) => run(() => api("/api/me/settings", { method: "PATCH", body: { readReceipts: e.target.checked } }), "Saved.")} /> Send read receipts in chats</label>
          <label className="check"><input type="checkbox" checked={u.doNotDisturb} onChange={(e) => run(() => api("/api/me/settings", { method: "PATCH", body: { doNotDisturb: e.target.checked } }), "Saved.")} /> Do not disturb for calls</label>
          <label className="check"><input type="checkbox" checked={u.shareCodeByDefault} onChange={(e) => run(() => api("/api/me/settings", { method: "PATCH", body: { shareCodeByDefault: e.target.checked } }), "Saved.")} /> Share my contact code by default on new posts</label>
        </div>
        <div className="row">
          <button className="btn ghost sm" onClick={() => run(async () => {
            const data = await api("/api/me/export");
            const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
            a.download = `pryingeyes-my-data.json`; a.click();
          }, "Your data was downloaded.")}>Download my data</button>
        </div>
      </div>

      <div className="card">
        <h2>Notifications</h2>
        {notes.length === 0 ? <p className="muted small">Nothing yet.</p> : <ul className="feed">{notes.slice(0, 15).map((n) => (
          <li key={n.id}><span className="t">{relTime(n.createdAt)}</span><span><b>{n.title}</b><br /><span className="muted small">{n.body}</span></span>{n.link ? <a className="small" href={n.link}>Open</a> : <span />}</li>))}</ul>}
      </div>

      <div className="card" style={{ borderColor: "var(--bad)" }}>
        <h2>Delete my account</h2>
        <p className="small">This deletes your numbers, tokens, chats and requests now, and from backups within 35 days. It can't be undone.</p>
        <label htmlFor="del">Type <b>DELETE MY ACCOUNT</b> to confirm</label>
        <div className="row"><input id="del" type="text" style={{ maxWidth: 280 }} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          <button className="btn danger" disabled={confirmText !== "DELETE MY ACCOUNT"} onClick={() => run(async () => { await api("/api/me/erase", { body: { confirm: confirmText } }); window.location.href = "/"; })}><Icon name="trash" size={16} />Delete</button></div>
      </div>
    </div>
  );
}
