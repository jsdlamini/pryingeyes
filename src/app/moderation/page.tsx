"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg, relTime } from "@/components/api";

export default function Moderation() {
  const [status, setStatus] = useState("open");
  const [rs, setRs] = useState<any[] | null>(null); const [err, setErr] = useState("");
  const load = useCallback(() => api(`/api/moderation?status=${status}`).then((r) => setRs(r.reports)).catch((e) => setErr(errMsg(e))), [status]);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  async function act(id: string, action: string) {
    const note = action === "dismiss" ? "" : prompt("Note for the record (optional)") ?? "";
    try { await api(`/api/moderation/${id}`, { body: { action, note } }); await load(); } catch (x) { setErr(errMsg(x)); }
  }
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="spread"><h1>Moderation queue</h1>
        <div className="chips">{["open", "actioned", "dismissed"].map((s) => <button key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>{s}</button>)}</div></div>
      <p className="muted small">Target: first response within 60 minutes. You see reports, metadata and only the messages a reporter chose to attach — never phone numbers.</p>
      {err && <div className="alert err">{err}</div>}
      {!rs ? <p>Loading…</p> : rs.length === 0 ? <div className="card muted">Nothing here.</div> : rs.map((r) => (
        <div className="card" key={r.id}>
          <div className="spread"><h2 style={{ margin: 0 }}>{r.reason} · @{r.reported}{r.kind === "post" ? " · post" : ""}</h2>
            <span className={`status ${r.slaBreached ? "bad" : "pending"}`}>{relTime(r.createdAt)}{r.slaBreached ? " · over 1 h" : ""}</span></div>
          <p className="small muted">Reported by @{r.reporter} · {r.reportsAgainstReported} report(s) against this account in total{r.resolution ? ` · ${r.resolution}` : ""}</p>
          {r.details?.text && <p>{r.details.text}</p>}
          {r.details?.messages?.length > 0 && <div className="msgs" style={{ minHeight: 0 }}>{r.details.messages.map((m: any, i: number) => <div key={i} className={`bubble ${m.from === "reporter" ? "mine" : "theirs"}`}>{m.text}<div className="tiny" style={{ opacity: .7 }}>{m.from}{m.where ? ` in ${m.where}` : ""} · {new Date(m.at).toLocaleString()}</div></div>)}</div>}
          {r.status === "open" && <div className="row" style={{ marginTop: 10 }}>
            <button className="btn ghost sm" onClick={() => act(r.id, "dismiss")}>Dismiss</button>
            <button className="btn ghost sm" onClick={() => act(r.id, "warn")}>Warn</button>
            {r.kind === "post"
              ? <button className="btn ghost sm" onClick={() => act(r.id, "remove_post")}>Remove post</button>
              : <button className="btn ghost sm" onClick={() => act(r.id, "close_conversation")}>Close conversation</button>}
            <button className="btn danger sm" onClick={() => act(r.id, "suspend")}>Suspend account</button></div>}
        </div>))}
    </div>
  );
}
