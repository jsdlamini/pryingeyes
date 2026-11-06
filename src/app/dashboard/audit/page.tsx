"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "@/components/api";
import { Feed, type FeedEntry } from "@/components/Feed";

export default function Audit() {
  const [events, setEvents] = useState<FeedEntry[]>([]);
  const [more, setMore] = useState(true); const [err, setErr] = useState("");
  const load = useCallback(async (before?: number) => {
    try {
      const r = await api(`/api/audit${before ? `?before=${before}` : ""}`);
      setEvents((e) => before ? [...e, ...r.events] : r.events); setMore(r.events.length === 50);
    } catch (x) { setErr(errMsg(x)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="spread"><h1>Audit trail</h1>
        <div className="row">
          <a className="btn ghost sm" href="/api/audit/export?format=pdf">Download evidence (PDF)</a>
          <a className="btn ghost sm" href="/api/audit/export?format=json">Signed evidence (JSON)</a>
        </div>
      </div>
      <p className="muted small">Every gate attempt, decision, reveal and call on your codes, from a tamper-evident log. Evidence packs are signed so a platform or the police can check they haven't been edited.</p>
      {err && <div className="alert err">{err}</div>}
      <div className="card"><Feed events={events} />
        {more && events.length > 0 && <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => load(events[events.length - 1].seq)}>Load older</button>}
      </div>
    </div>
  );
}
