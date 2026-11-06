"use client";
import { useEffect, useState } from "react";
import { api, errMsg } from "@/components/api";

/** Development only: shows the emails the app would have sent. */
export default function Outbox() {
  const [ms, setMs] = useState<any[] | null>(null); const [err, setErr] = useState("");
  useEffect(() => { const l = () => api("/api/dev/outbox").then((r) => setMs(r.messages)).catch((e) => setErr(errMsg(e))); l(); const t = setInterval(l, 3000); return () => clearInterval(t); }, []);
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1>Development outbox</h1>
      <p className="muted small">Messages captured instead of being sent. Phone numbers appear masked. This page doesn't exist in production.</p>
      {err && <div className="alert err">{err}</div>}
      <div className="card">{!ms ? <p>Loading…</p> : ms.length === 0 ? <p className="muted">Empty.</p> : <ul className="feed">{ms.map((m) => (
        <li key={m.id}><span className="t">{new Date(m.createdAt).toLocaleTimeString()}</span>
          <span><b>{m.channel.toUpperCase()}</b> to {m.to}{m.subject ? ` · ${m.subject}` : ""}<br /><span className="small" style={{ whiteSpace: "pre-wrap" }}>{m.body.replace(/(https?:\/\/[^\s]+)/g, "$1")}</span></span>
          <span>{m.body.match(/https?:\/\/\S+verify-email\S+/) ? <a className="btn sm" href={m.body.match(/https?:\/\/\S+/)[0]}>Open link</a> : null}</span></li>))}</ul>}</div>
    </div>
  );
}
