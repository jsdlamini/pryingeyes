"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, errMsg, relTime } from "@/components/api";

export default function Chats() {
  const [cs, setCs] = useState<any[] | null>(null); const [err, setErr] = useState("");
  useEffect(() => { api("/api/chats").then((r) => setCs(r.conversations)).catch((e) => setErr(errMsg(e))); }, []);
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1>Chats</h1>
      <p className="muted small">Private messages with people who used one of your links, or whose link you used. Phone numbers are never shared in chats.</p>
      {err && <div className="alert err">{err}</div>}
      <div className="card">
        {!cs ? <p>Loading…</p> : cs.length === 0 ? (
          <div className="stack">
            <p><b>No conversations yet.</b></p>
            <p className="small muted">Chats start from a PryingEyes link or code — nobody can message you out of the blue.</p>
            <ul className="small">
              <li><b>To reach someone:</b> open the link they shared (or enter their code on the <Link href="/">home page</Link>), pass the checks, then choose <i>Chat in the app</i>.</li>
              <li><b>To let people reach you:</b> add a number, then <Link href="/dashboard/tokens/new">create a link</Link> with chat allowed and share it. When someone starts a chat, it shows up here and we notify you.</li>
            </ul>
          </div>
        ) : (
          <ul className="feed">{cs.map((c) => (
            <li key={c.id}><span className="t">{relTime(c.lastMessageAt)}</span>
              <span><Link href={`/chats/${c.id}`}><b>@{c.with}</b></Link> · <i>{c.label}</i>{c.disappearSeconds ? <span className="muted tiny"> · disappearing</span> : null}<br /><span className="muted tiny">{c.role === "owner" ? "Contacted you" : "You contacted them"}</span></span>
              {c.unread ? <span className="badge">{c.unread}</span> : <span />}</li>))}</ul>
        )}
      </div>
    </div>
  );
}
