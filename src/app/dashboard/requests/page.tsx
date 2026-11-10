"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg, relTime } from "@/components/api";
import { Icon } from "@/components/Icon";

type R = { id: string; appOnly?: boolean; stage: string; label: string; createdAt: string; consentExpiresAt: string | null; note: string | null;
  caller: { handle: string; verification: string; region: string | null; accountCreatedAt: string; reports: number; priorRequests: number } };

const ageOf = (d: string) => { const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000); return days < 1 ? "today" : days < 60 ? `${days} days` : days < 730 ? `${Math.round(days / 30)} months` : `${Math.round(days / 365)} years`; };

export default function Requests() {
  const [rs, setRs] = useState<R[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => api("/api/requests").then((r) => setRs(r.requests)).catch((e) => setErr(errMsg(e))), []);
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);
  async function decide(id: string, decision: string) {
    if (decision === "decline_block" && !confirm("Decline and block this person from all your codes?")) return;
    try { await api(`/api/requests/${id}/decision`, { body: { decision } }); await load(); } catch (x) { setErr(errMsg(x)); }
  }
  const pending = rs?.filter((r) => r.stage === "consent_pending" && (!r.consentExpiresAt || new Date(r.consentExpiresAt) > new Date())) ?? [];
  const past = rs?.filter((r) => !pending.includes(r)) ?? [];
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1>Requests</h1>
      {err && <div className="alert err" role="alert">{err}</div>}
      {!rs ? <p>Loading…</p> : pending.length === 0 ? <div className="card muted">No one is waiting. People reaching your “Ask me” codes appear here.</div> : pending.map((r) => (
        <div className="card" key={r.id} data-testid="request-card">
          <div className="spread"><div><span className="muted small">Request · {r.label}</span><h2 style={{ margin: 0 }}>@{r.caller.handle} wants to reach you</h2></div>
            <span className="status pending">Expires {relTime(r.consentExpiresAt)}</span></div>
          <div className="stats" style={{ marginTop: 12 }}>
            <div className="stat"><span>Verified</span><b style={{ fontSize: "1rem" }}>{r.caller.verification.replace("account+captcha+otp", "Account + human check + code").replace("account+captcha", "Account + human check")}</b></div>
            <div className="stat"><span>Account age</span><b style={{ fontSize: "1rem" }}>{ageOf(r.caller.accountCreatedAt)}</b></div>
            <div className="stat"><span>Region</span><b style={{ fontSize: "1rem" }}>{r.caller.region ?? "Unknown"}</b></div>
            <div className="stat"><span>Reports</span><b style={{ fontSize: "1rem" }}>{r.caller.reports || "None"}</b></div>
          </div>
          {r.note && <blockquote style={{ borderLeft: "3px solid var(--accent-2)", margin: "0 0 12px", padding: "6px 12px", fontStyle: "italic" }}>“{r.note}”</blockquote>}
          {r.caller.priorRequests > 0 && <p className="small muted">They've made {r.caller.priorRequests} earlier request(s) to you.</p>}
          <div className="row">
            <button className="btn" onClick={() => decide(r.id, "approve_relay")}><Icon name="userCheck" size={16} />Allow messages and calls</button>
            {!r.appOnly && <button className="btn ghost" onClick={() => decide(r.id, "reveal_once")}><Icon name="eye" size={16} />Show my number once</button>}
            <button className="btn ghost" onClick={() => decide(r.id, "decline")}><Icon name="x" size={16} />Decline</button>
            <button className="btn danger-ghost" onClick={() => decide(r.id, "decline_block")}><Icon name="block" size={16} />Decline &amp; block</button>
          </div>
        </div>
      ))}
      {past.length > 0 && <div className="card"><h2>Recent decisions</h2><ul className="feed">{past.slice(0, 20).map((r) => (
        <li key={r.id}><span className="t">{relTime(r.createdAt)}</span><span>@{r.caller.handle} · <i>{r.label}</i></span>
          <span className={`status ${r.stage.startsWith("approved") ? "good" : "bad"}`}>{({ approved_relay: "Approved", approved_reveal: "Number shown once", declined: "Declined", expired: "Expired" } as Record<string, string>)[r.stage] ?? r.stage}</span></li>))}</ul></div>}
    </div>
  );
}
