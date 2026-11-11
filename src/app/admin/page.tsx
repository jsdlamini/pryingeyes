"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg, relTime } from "@/components/api";

export default function Admin() {
  const [as, setAs] = useState<any[] | null>(null); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [f, setF] = useState({ action: "suspend_user", handle: "", role: "moderator", reason: "" });
  const [lh, setLh] = useState(""); const [lu, setLu] = useState<any | null>(null);
  const [users, setUsers] = useState<any[] | null>(null);
  const [funnel, setFunnel] = useState<Record<string, number> | null>(null);
  useEffect(() => { api("/api/admin/funnel").then((r) => setFunnel(r.totals)).catch(() => undefined); }, []); const [ua, setUa] = useState({ handle: "", action: "suspend_user", role: "moderator", reason: "" });
  const load = useCallback(() => api("/api/admin/actions").then((r) => setAs(r.actions)).catch((e) => setErr(errMsg(e))), []);
  useEffect(() => { load(); }, [load]);
  async function request(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    const req: any = { action: f.action };
    if (f.action !== "rewrap_keys") req.handle = f.handle;
    if (f.action.endsWith("_role")) req.role = f.role;
    try { await api("/api/admin/actions", { body: { request: req, reason: f.reason } }); setMsg("Requested. Another administrator must approve it."); await load(); } catch (x) { setErr(errMsg(x)); }
  }
  const loadUsers = useCallback(() => api("/api/admin/users").then((r) => setUsers(r.users)).catch((e) => setErr(errMsg(e))), []);
  useEffect(() => { loadUsers(); }, [loadUsers]);
  async function userAct(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    try { const r = await api("/api/admin/users", { body: { request: { action: ua.action, handle: ua.handle.trim(), ...(ua.action.endsWith("_role") ? { role: ua.role } : {}) }, reason: ua.reason } }); setMsg(r.result); await loadUsers(); }
    catch (x) { setErr(errMsg(x)); }
  }
  async function viewCodes(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setLu(null);
    if (!lh.trim()) return;
    try { setLu(await api(`/api/admin/user-codes?handle=${encodeURIComponent(lh.trim())}`)); } catch (x) { setErr(errMsg(x)); }
  }
  async function decide(id: string, approve: boolean) {
    try { const r = await api(`/api/admin/actions/${id}`, { body: { approve } }); setMsg(r.result ?? "Rejected."); await load(); } catch (x) { setErr(errMsg(x)); }
  }
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <h1>Break-glass administration</h1>
      <p className="muted small">Every action needs two administrators: one requests, a different one approves. Both steps are written to the audit log. Requests expire after 24 hours.</p>
      {err && <div className="alert err">{err}</div>}{msg && <div className="alert ok">{msg}</div>}
      {funnel && <div className="card"><h2>Funnel (last 30 days)</h2><p className="muted small" style={{ margin: 0 }}>Opened {funnel.opened ?? 0} · Signed up {funnel.signup_completed ?? 0} · Reached {funnel.reached ?? 0} · Loop codes {funnel.loop_code_created ?? 0}{funnel.reached ? ` · Conversion ${Math.round(((funnel.loop_code_created ?? 0) / funnel.reached) * 100)}%` : ""}</p></div>}
      <div className="card">
        <h2>Users</h2>
        <p className="muted small">Every account on this server, with the actions you can take directly.</p>
        <form onSubmit={userAct} className="row" style={{ alignItems: "center", marginBottom: 10 }}>
          <input type="text" value={ua.handle} onChange={(e) => setUa({ ...ua, handle: e.target.value })} placeholder="Handle" aria-label="Handle" style={{ minWidth: 160 }} />
          <select value={ua.action} onChange={(e) => setUa({ ...ua, action: e.target.value })}>
            <option value="suspend_user">Suspend</option><option value="unsuspend_user">Unsuspend</option>
            <option value="grant_role">Grant role</option><option value="revoke_role">Revoke role</option>
          </select>
          {ua.action.endsWith("_role") && <select value={ua.role} onChange={(e) => setUa({ ...ua, role: e.target.value })}><option>moderator</option><option>admin</option></select>}
          <input type="text" value={ua.reason} onChange={(e) => setUa({ ...ua, reason: e.target.value })} placeholder="Reason" aria-label="Reason" style={{ minWidth: 160 }} />
          <button className="btn sm">Apply</button>
        </form>
        {!users ? <p>Loading…</p> : users.length === 0 ? <p className="muted small">No users.</p> : (
          <div className="tablewrap"><table className="tbl"><thead><tr><th>Handle</th><th>Email</th><th>Status</th><th>Roles</th><th className="hide-sm">Verified</th><th>Codes</th><th>Actions</th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id}>
              <td><b>@{u.handle}</b></td>
              <td className="small">{u.email ?? "—"}</td>
              <td><span className={`status ${u.status === "active" ? "good" : "bad"}`}>{u.status}</span></td>
              <td className="small">{u.roles.length ? u.roles.join(", ") : "—"}</td>
              <td className="hide-sm small">{u.emailVerified ? "yes" : "no"}</td>
              <td>{u.codeCount}</td>
              <td>
                <div className="stack" style={{ gap: 4 }}>
                  <button className="btn ghost sm" onClick={() => setLh(u.handle)}>Codes</button>
                  <button className="btn ghost sm" onClick={() => setUa({ handle: u.handle, action: u.status === "suspended" ? "unsuspend_user" : "suspend_user", role: "moderator", reason: "" })}>{u.status === "suspended" ? "Unsuspend" : "Suspend"}</button>
                </div>
              </td>
            </tr>
          ))}</tbody></table></div>
        )}
      </div>
      <div className="card">
        <h2>View a user’s codes</h2>
        <p className="muted small">Read-only: shows every code (active and historical) a user owns.</p>
        <form onSubmit={viewCodes} className="row" style={{ alignItems: "center" }}>
          <input type="text" value={lh} onChange={(e) => setLh(e.target.value)} placeholder="Handle" aria-label="Handle" style={{ minWidth: 180 }} />
          <button className="btn sm">View codes</button>
        </form>
        {lu && (lu.tokens?.length ? (
          <table className="tbl" style={{ marginTop: 10 }}><thead><tr><th>Label</th><th>Status</th><th>Short code</th><th>Link</th><th>Uses</th></tr></thead>
          <tbody>{lu.tokens.map((t: any) => (
            <tr key={t.id}><td>{t.label}</td><td><span className={`status ${t.status === "active" ? "good" : t.status === "revoked" ? "bad" : "pending"}`}>{t.status}</span></td>
            <td className="mono">{t.short ?? `${t.displayPrefix}—····`}</td><td className="mono small" style={{ wordBreak: "break-all" }}>{t.link ?? "—"}</td><td>{t.uses}</td></tr>
          ))}</tbody></table>
        ) : <p className="muted small" style={{ marginTop: 8 }}>No codes for that handle.</p>)}
      </div>
      <form className="card" onSubmit={request}>
        <h2>Request an action</h2>
        <div className="grid2">
          <div className="field"><label htmlFor="act">Action</label><select id="act" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
            <option value="suspend_user">Suspend user</option><option value="unsuspend_user">Unsuspend user</option>
            <option value="grant_role">Grant role</option><option value="revoke_role">Revoke role</option><option value="rewrap_keys">Re-wrap data keys (after KEK rotation)</option></select></div>
          {f.action !== "rewrap_keys" && <div className="field"><label htmlFor="h">Handle</label><input id="h" type="text" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} /></div>}
          {f.action.endsWith("_role") && <div className="field"><label htmlFor="r">Role</label><select id="r" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option>moderator</option><option>admin</option></select></div>}
        </div>
        <div className="field"><label htmlFor="why">Reason</label><input id="why" type="text" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
        <button className="btn" disabled={f.reason.length < 10}>Request</button>
      </form>
      <div className="card">
        <h2>Requests</h2>
        {!as ? <p>Loading…</p> : <table className="tbl"><thead><tr><th>Action</th><th>By</th><th>Reason</th><th>Status</th><th /></tr></thead><tbody>
          {as.map((a) => <tr key={a.id}><td>{a.action}<br /><span className="muted tiny">{JSON.stringify(a.params)}</span></td><td>@{a.requestedByHandle} <span className="muted tiny">{relTime(a.createdAt)}</span></td>
            <td className="small">{a.reason}{a.result ? <><br /><span className="muted">{a.result}</span></> : null}</td><td><span className={`status ${a.status === "executed" ? "good" : a.status === "pending" ? "pending" : "bad"}`}>{a.status}</span></td>
            <td>{a.status === "pending" && <div className="row"><button className="btn sm" onClick={() => decide(a.id, true)}>Approve</button><button className="btn ghost sm" onClick={() => decide(a.id, false)}>Reject</button></div>}</td></tr>)}
        </tbody></table>}
      </div>
    </div>
  );
}
