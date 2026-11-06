"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg, clock } from "@/components/api";
import { KindPicker, MessageText, type CodeKind } from "@/components/Social";
import { Icon } from "@/components/Icon";

const callLine = (c: { status: string; durationSec: number }, role?: string) => {
  const d = c.durationSec ? ` · ${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, "0")}` : "";
  if (c.status === "ended") return `In-app call${d}`;
  if (c.status === "missed" || c.status === "cancelled" || c.status === "busy") return role === "owner" ? "Missed call" : "Call not answered";
  if (c.status === "declined") return "Call declined";
  if (c.status === "ringing" || c.status === "accepted") return "Call in progress";
  return "Call failed";
};

type Msg = { id: string; mine: boolean; at: string; text: string; read: boolean; expiresAt: string | null };

export default function Conversation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [conv, setConv] = useState<any>(null);
  const [callOpt, setCallOpt] = useState<{ canStart: boolean; requestId?: string; reason?: string; appCall?: boolean } | null>(null);
  const [calls, setCalls] = useState<{ id: string; at: string; status: string; durationSec: number }[]>([]);
  const [calling, setCalling] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState(""); const [err, setErr] = useState("");
  // Share a contact code in this chat (for example for someone else to use). Opens the owner's gate when tapped.
  const [sharing, setSharing] = useState(false); const [kind, setKind] = useState<CodeKind>("one"); const [tier, setTier] = useState(1);
  const [reporting, setReporting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]); const [reason, setReason] = useState("harassment"); const [details, setDetails] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const load = useCallback(() => api(`/api/chats/${id}/messages`).then((r) => { setConv(r.conversation); setMsgs(r.messages); setCalls(r.calls ?? []); setCallOpt(r.call ?? null); }).catch((e) => setErr(errMsg(e))), [id]);
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [load]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs.length]);
  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!text.trim()) return;
    try { await api(`/api/chats/${id}/messages`, { body: { text, attach: sharing ? { tier, kind } : null } }); setText(""); setSharing(false); await load(); } catch (x) { setErr(errMsg(x)); }
  }
  async function startCall() {
    if (!callOpt?.requestId) return;
    setCalling(true); setErr("");
    try {
      const r = await api(`/api/gate/${callOpt.requestId}/outcome`, { body: { choice: "app_call" } });
      if (r.appCallId) { window.location.href = `/calls/${r.appCallId}`; return; }
      setErr("Calling isn't available right now. Open the owner's link again to start a call.");
    } catch (x) { setErr(errMsg(x)); } finally { setCalling(false); }
  }
  async function block() {
    if (!confirm("Block this person? Neither of you will be able to send messages here, and they can't reach your codes.")) return;
    try { await api(`/api/chats/${id}/block`, { body: {} }); await load(); } catch (x) { setErr(errMsg(x)); }
  }
  async function report(e: React.FormEvent) {
    e.preventDefault();
    try { await api("/api/reports", { body: { conversationId: id, reason, details, messageIds: picked, block: true } }); setReporting(false); setPicked([]); setErr(""); alert("Thanks. A moderator will review this, and the person is blocked."); await load(); }
    catch (x) { setErr(errMsg(x)); }
  }
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      {conv && <div className="spread"><div><h1 style={{ marginBottom: 0 }}>@{conv.with}</h1><p className="muted small">About “{conv.label}”{conv.disappearSeconds ? " · messages disappear after 24 hours" : ""}</p></div>
        <div className="row">{conv.role === "caller" && callOpt?.canStart && !conv.blocked && <>
          {callOpt.appCall && <button className="btn accent sm" onClick={startCall} disabled={calling}><Icon name="headset" size={16} />Call in the app</button>}</>}<button className="iconbtn danger" onClick={block} disabled={conv.blocked} aria-label={conv.blocked ? "Blocked" : "Block"} title={conv.blocked ? "Blocked" : "Block"}><Icon name="block" size={18} /></button><button className="iconbtn" onClick={() => setReporting(!reporting)} aria-label="Report" title="Report" aria-pressed={reporting}><Icon name="flag" size={18} /></button></div></div>}
      {conv && <div className="privacy-note" style={{ marginTop: 10 }}><Icon name="lock" size={16} /><span>
        {conv.role === "owner"
          ? <>@{conv.with} reached you through your link “{conv.label}”. They can't see your number, and you can't see theirs. Only they can start a call. If you have PryingEyes open it rings here; if not, you'll get a missed-call notification and can reply in this chat.</>
          : callOpt?.canStart
            ? <>Messages are encrypted and no numbers are shared. Want to talk? <b>Call in the app</b> rings @{conv.with} over the internet, with no phone numbers involved. If they're not in the app, they'll see a missed call.</>
            : <>Messages are encrypted and no numbers are shared.{callOpt?.reason === "pass_gate_again" ? " To call, open the owner's link again — calls need a fresh check and the owner's link must allow them." : ""}</>}
      </span></div>}
      {err && <div className="alert err" role="alert">{err}</div>}
      {reporting && <form className="card stack" onSubmit={report}>
        <b>Report this conversation</b>
        <p className="small muted">Tick the messages to include. Only the messages you choose are sent to moderators.</p>
        <div className="field"><label htmlFor="reason">Reason</label><select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}>{["harassment", "threats", "scam", "spam", "impersonation", "other"].map((r) => <option key={r}>{r}</option>)}</select></div>
        <div className="field"><label htmlFor="det">What happened? (optional)</label><textarea id="det" maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} /></div>
        <div className="row"><button className="btn danger"><Icon name="flag" size={16} />Report and block</button><button type="button" className="btn ghost" onClick={() => setReporting(false)}>Cancel</button></div>
      </form>}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="msgs" ref={box} aria-live="polite">
          {msgs.length === 0 && <p className="muted small" style={{ margin: "auto" }}>No messages yet. Say hello.</p>}
          {[...msgs.map((m) => ({ kind: "msg" as const, at: m.at, m })), ...calls.map((c) => ({ kind: "call" as const, at: c.at, c }))]
            .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
            .map((it) => it.kind === "call" ? (
              <div key={it.c.id} className="callevent">{callLine(it.c, conv?.role)} · {clock(it.c.at)}</div>
            ) : ((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "flex-end", gap: 6, flexDirection: m.mine ? "row-reverse" : "row" }}>
              {reporting && <input type="checkbox" aria-label="Include in report" checked={picked.includes(m.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, m.id] : picked.filter((x) => x !== m.id))} />}
              <div className={`bubble ${m.mine ? "mine" : "theirs"}`}><MessageText text={m.text} mine={m.mine} /><div className="tiny" style={{ opacity: .7, marginTop: 2 }}>{clock(m.at)}{m.mine && m.read ? " · read" : ""}</div></div>
            </div>
          ))(it.m))}
        </div>
        {sharing && !conv?.blocked && (
          <div className="card stack small" style={{ marginTop: 10 }} data-testid="share-code-panel">
            <p className="muted" style={{ margin: 0 }}>Your message will include one of your contact codes. Whoever taps it reaches you through PryingEyes, without your number or email.</p>
            <div className="chips">{[1, 2, 3].map((n) => <button type="button" key={n} className="chip" aria-pressed={tier === n} onClick={() => setTier(n)}>{["", "Open", "Verified", "Consent"][n]}</button>)}</div>
            <KindPicker kind={kind} setKind={setKind} />
          </div>
        )}
        <form onSubmit={send} className="chatbar">
          <button type="button" className="plus" aria-pressed={sharing} onClick={() => setSharing(!sharing)} disabled={conv?.blocked} data-testid="chat-share-code" title="Share my contact code"><Icon name="mark" size={19} /><span className="sr-only">Share my contact code</span></button>
          <label htmlFor="msg" className="sr-only">Message</label>
          <input id="msg" type="text" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder={conv?.blocked ? "This conversation is blocked" : "Type a message here…"} disabled={conv?.blocked} />
          <button className="sendbtn" disabled={(!text.trim() && !sharing) || conv?.blocked} aria-label="Send" title="Send"><Icon name="send" size={24} /></button>
        </form>
      </div>
    </div>
  );
}
