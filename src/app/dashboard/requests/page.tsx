"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg, relTime } from "@/components/api";
import { Icon } from "@/components/Icon";

type R = { id: string; appOnly?: boolean; stage: string; label: string; createdAt: string; consentExpiresAt: string | null; note: string | null;
  caller: { handle: string; verification: string; region: string | null; accountCreatedAt: string; reports: number; priorRequests: number;
    emailVerified?: boolean; passkey?: boolean; authenticator?: boolean } };
type Decision = "approve_relay" | "reveal_once" | "decline" | "decline_block";
type Pending = { id: string; handle: string; decision: Decision; left: number };

const days = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
const ageWords = (n: number) => n < 1 ? "Joined today" : n < 60 ? `Joined ${n} day${n === 1 ? "" : "s"} ago` : n < 730 ? `Joined ${Math.round(n / 30)} months ago` : `Joined ${Math.round(n / 365)} years ago`;
const DONE_WORDS: Record<Decision, string> = { approve_relay: "Approved", reveal_once: "Number shown once to", decline: "Declined", decline_block: "Declined and blocked" };
const UNDO_SECONDS = 5;

/** Requests: each card shows what the owner decides on; a decision can be undone for 5 seconds. */
export default function Requests() {
  const [rs, setRs] = useState<R[] | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"waiting" | "decided">("waiting");
  const [open, setOpen] = useState<string | null>(null);          // which card shows its extra options
  const [pending, setPending] = useState<Pending | null>(null);   // decision waiting out its undo window
  const pendingRef = useRef<Pending | null>(null);
  const load = useCallback(() => api("/api/requests").then((r) => setRs(r.requests)).catch((e) => setErr(errMsg(e))), []);
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const send = useCallback(async (p: Pending) => {
    pendingRef.current = null; setPending(null);
    try { await api(`/api/requests/${p.id}/decision`, { body: { decision: p.decision } }); } catch (x) { setErr(errMsg(x)); }
    await load();
  }, [load]);

  // Count down the undo window, then send. Leaving the page sends straight away, so nothing is lost.
  useEffect(() => {
    if (!pending) return;
    if (pending.left <= 0) { void send(pending); return; }
    const t = setTimeout(() => setPending((p) => (p ? { ...p, left: p.left - 1 } : p)), 1000);
    return () => clearTimeout(t);
  }, [pending, send]);
  useEffect(() => () => { const p = pendingRef.current; if (p) void api(`/api/requests/${p.id}/decision`, { body: { decision: p.decision } }).catch(() => undefined); }, []);

  function decide(r: R, decision: Decision) {
    if (decision === "decline_block" && !confirm(`Decline and block @${r.caller.handle} from all your codes?`)) return;
    if (pendingRef.current) void send(pendingRef.current);    // a second decision sends the first now
    const p = { id: r.id, handle: r.caller.handle, decision, left: UNDO_SECONDS };
    pendingRef.current = p; setPending(p); setOpen(null);
  }
  function undo() { pendingRef.current = null; setPending(null); }

  const waiting = (rs ?? []).filter((r) => r.stage === "consent_pending" && (!r.consentExpiresAt || new Date(r.consentExpiresAt) > new Date()) && r.id !== pending?.id);
  const decided = (rs ?? []).filter((r) => !waiting.includes(r) && r.id !== pending?.id);

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 style={{ marginBottom: 4 }}>Requests</h1>
      <div className="seg" role="tablist" aria-label="Requests">
        <button role="tab" aria-selected={tab === "waiting"} onClick={() => setTab("waiting")}>Waiting{waiting.length > 0 && <span className="n">{waiting.length}</span>}</button>
        <button role="tab" aria-selected={tab === "decided"} onClick={() => setTab("decided")}>Decided</button>
      </div>
      {err && <div className="alert err" role="alert">{err}</div>}

      {!rs ? <p>Loading…</p> : tab === "waiting" ? (
        waiting.length === 0 ? <div className="card muted">No one is waiting. People reaching your &ldquo;Ask me&rdquo; codes appear here.</div> : waiting.map((r) => {
          const age = days(r.caller.accountCreatedAt);
          const secondFactor = r.caller.passkey ? "Passkey on" : r.caller.authenticator ? "Authenticator on" : null;
          return (
            <article className="req" key={r.id} data-testid="request-card" aria-label={`Request from ${r.caller.handle}`}>
              <div className="req-head">
                <span className="req-ava" aria-hidden="true">{r.caller.handle.slice(0, 2)}</span>
                <span className="req-who">
                  <h2>@{r.caller.handle} wants to reach you</h2>
                  <span className="sub">via <b>{r.label}</b> · Ask me · {relTime(r.createdAt)}</span>
                </span>
              </div>
              <ul className="facts">
                <li className={r.caller.emailVerified ? "good" : "warn"}><Icon name={r.caller.emailVerified ? "check" : "mail"} size={16} />{r.caller.emailVerified ? "Email verified" : "Email not verified"}</li>
                <li className={secondFactor ? "good" : "info"}><Icon name="key" size={16} />{secondFactor ?? "No passkey"}</li>
                <li className={age < 14 ? "warn" : "info"}><Icon name="clock" size={16} />{ageWords(age)}</li>
                <li className="info"><Icon name="compass" size={16} />{r.caller.region ?? "Country unknown"}</li>
                {r.caller.reports > 0 && <li className="bad"><Icon name="flag" size={16} />Reported {r.caller.reports}×</li>}
                {r.caller.priorRequests > 0 && <li className="info"><Icon name="refresh" size={16} />{r.caller.priorRequests} earlier request{r.caller.priorRequests === 1 ? "" : "s"}</li>}
              </ul>
              {r.note && <blockquote className="req-note">&ldquo;{r.note}&rdquo;</blockquote>}
              <div className="req-actions">
                <button className="btn ok-grad" onClick={() => decide(r, "approve_relay")}><Icon name="userCheck" size={16} />Approve</button>
                <button className="btn ghost" onClick={() => decide(r, "decline")}>Decline</button>
                <button className="iconbtn" style={{ width: 46, height: 46, flex: "none" }} aria-expanded={open === r.id} aria-label="More options" onClick={() => setOpen(open === r.id ? null : r.id)}><Icon name="more" size={18} /></button>
              </div>
              {open === r.id && (
                <div className="row" style={{ marginTop: 10 }}>
                  {!r.appOnly && <button className="btn ghost sm" onClick={() => decide(r, "reveal_once")}><Icon name="eye" size={15} />Show my number once</button>}
                  <button className="btn danger-ghost sm" onClick={() => decide(r, "decline_block")}><Icon name="block" size={15} />Decline and block</button>
                </div>
              )}
              <p className="tiny muted" style={{ margin: "10px 0 0", textAlign: "center" }}>Expires {relTime(r.consentExpiresAt)}. Approving lets them message and call you in the app — never your number.</p>
            </article>
          );
        })
      ) : (
        decided.length === 0 ? <div className="card muted">No decisions yet.</div> : <div className="card"><ul className="feed">{decided.slice(0, 30).map((r) => (
          <li key={r.id}><span className="t">{relTime(r.createdAt)}</span><span>@{r.caller.handle} · <i>{r.label}</i></span>
            <span className={`status ${r.stage.startsWith("approved") ? "good" : "bad"}`}>{({ approved_relay: "Approved", approved_reveal: "Number shown once", declined: "Declined", expired: "Expired", consent_pending: "Expired" } as Record<string, string>)[r.stage] ?? r.stage}</span></li>))}</ul></div>
      )}

      {pending && (
        <div className="undo-toast" role="status">
          <Icon name="check" size={18} />
          <span>{DONE_WORDS[pending.decision]} @{pending.handle}</span>
          <button onClick={undo}>Undo · {pending.left}</button>
        </div>
      )}
    </div>
  );
}
