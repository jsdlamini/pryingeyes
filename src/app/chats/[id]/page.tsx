"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg, clock } from "@/components/api";
import { KindPicker, MessageText, type CodeKind } from "@/components/Social";
import { uploadAudio, uploadImage } from "@/components/upload";
import { ReactionBar } from "@/components/ReactionBar";
import { Icon } from "@/components/Icon";
import { TIER_NAMES } from "@/components/Tier";

const callLine = (c: { status: string; durationSec: number }, role?: string) => {
  const d = c.durationSec ? ` · ${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, "0")}` : "";
  if (c.status === "ended") return `In-app call${d}`;
  if (c.status === "missed" || c.status === "cancelled" || c.status === "busy") return role === "owner" ? "Missed call" : "Call not answered";
  if (c.status === "declined") return "Call declined";
  if (c.status === "ringing" || c.status === "accepted") return "Call in progress";
  return "Call failed";
};

type Msg = { id: string; mine: boolean; at: string; text: string; read: boolean; expiresAt: string | null; attachment: string | null; attachmentKind: string | null; viewOnce: boolean; reactions: { emoji: string; count: number; mine: boolean }[] };

function ViewOnce({ src, onConsume }: { src: string; onConsume: () => void }) {
  const [shown, setShown] = useState(false);
  if (shown) return <img src={src} alt="" className="msg-attach" />;
  return <button type="button" className="viewonce" onClick={() => { setShown(true); onConsume(); }}><Icon name="eye" size={15} /> View once</button>;
}

export default function Conversation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [conv, setConv] = useState<any>(null);
  const [callOpt, setCallOpt] = useState<{ canStart: boolean; requestId?: string; reason?: string; appCall?: boolean; chatCall?: boolean } | null>(null);
  const [calls, setCalls] = useState<{ id: string; at: string; status: string; durationSec: number }[]>([]);
  const [calling, setCalling] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState(""); const [err, setErr] = useState("");
  // Share a contact code in this chat (for example for someone else to use). Opens the owner's gate when tapped.
  const [sharing, setSharing] = useState(false); const [kind, setKind] = useState<CodeKind>("one"); const [tier, setTier] = useState(1);
  const [reporting, setReporting] = useState(false);
  const [safety, setSafety] = useState(""); const [safetyOpen, setSafetyOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]); const [reason, setReason] = useState("harassment"); const [details, setDetails] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const [recording, setRecording] = useState(false); const [recTime, setRecTime] = useState(0); const [viewOnce, setViewOnce] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null); const chunksRef = useRef<Blob[]>([]); const fileRef = useRef<HTMLInputElement>(null);
  // Polling: every 3 s only messages newer than the last one we have (much less to decrypt and send);
  // a full refresh every 30 s picks up reactions, read receipts and opened view-once photos.
  // Nothing is fetched while the tab is hidden.
  const lastAt = useRef<string | null>(null);
  const load = useCallback((full = true) => {
    const q = !full && lastAt.current ? `?after=${encodeURIComponent(lastAt.current)}` : "";
    return api(`/api/chats/${id}/messages${q}`).then((r) => {
      setConv(r.conversation); setCalls(r.calls ?? []); setCallOpt(r.call ?? null);
      if (q) setMsgs((prev) => { const seen = new Set(prev.map((m) => m.id)); return [...prev, ...(r.messages as Msg[]).filter((m) => !seen.has(m.id))]; });
      else setMsgs(r.messages);
      const last = (r.messages as Msg[]).at(-1);
      if (last) lastAt.current = String(last.at);
    }).catch((e) => setErr(errMsg(e)));
  }, [id]);
  useEffect(() => {
    lastAt.current = null; load();
    let ticks = 0;
    const t = setInterval(() => { if (document.visibilityState !== "visible") return; ticks++; load(ticks % 10 === 0); }, 3000);
    const back = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); };
  }, [load]);
  useEffect(() => { if (!recording) { setRecTime(0); return; } const id = setInterval(() => setRecTime((t) => t + 1), 1000); return () => clearInterval(id); }, [recording]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs.length]);
  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!text.trim()) return;
    try { await api(`/api/chats/${id}/messages`, { body: { text, attach: sharing ? { tier, kind } : null } }); setText(""); setSharing(false); await load(); } catch (x) { setErr(errMsg(x)); }
  }
  async function startVoice() {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recRef.current = rec; chunksRef.current = chunks;
      rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (!chunks.length) return;
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        try { await api(`/api/chats/${id}/messages`, { body: { text: "", attach: null, attachment: await uploadAudio(blob), attachmentKind: "voice" } }); await load(); }
        catch (x) { setErr(errMsg(x)); }
      };
      rec.start(); setRecording(true);
    } catch { setErr("PryingEyes needs your microphone for voice notes. Allow it in your browser settings, then try again."); }
  }
  function stopVoice() { recRef.current?.stop(); }
  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setErr("");
    try { await api(`/api/chats/${id}/messages`, { body: { text: "", attach: null, attachment: await uploadImage(f), attachmentKind: "image", viewOnce } }); await load(); }
    catch (x) { setErr(errMsg(x)); }
  }
  async function startCall() {
    setCalling(true); setErr("");
    try {
      if (callOpt?.requestId && callOpt.appCall) {
        const r = await api(`/api/gate/${callOpt.requestId}/outcome`, { body: { choice: "app_call" } });
        if (r.appCallId) { window.location.href = `/calls/${r.appCallId}`; return; }
      } else if (callOpt?.chatCall) {
        const r = await api(`/api/chats/${id}/call`, { body: {} });
        if (r.id) { window.location.href = `/calls/${r.id}`; return; }
      }
      setErr("Calling isn't available right now. Please try again.");
    } catch (x) { setErr(errMsg(x)); } finally { setCalling(false); }
  }
  async function block() {
    if (!confirm("Block this person? Neither of you will be able to send messages here, and they can't reach your codes.")) return;
    try { await api(`/api/chats/${id}/block`, { body: {} }); await load(); } catch (x) { setErr(errMsg(x)); }
  }
  async function verify() {
    setSafetyOpen((o) => !o);
    if (!safety) {
      try { const r = await api(`/api/chats/${id}/safety`); setSafety(r.safety); }
      catch (x) { setErr(errMsg(x)); }
    }
  }
  async function report(e: React.FormEvent) {
    e.preventDefault();
    try { await api("/api/reports", { body: { conversationId: id, reason, details, messageIds: picked, block: true } }); setReporting(false); setPicked([]); setErr(""); alert("Thanks. A moderator will review this, and the person is blocked."); await load(); }
    catch (x) { setErr(errMsg(x)); }
  }
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      {conv && <div className="spread"><div><h1 style={{ marginBottom: 0 }}>@{conv.with}</h1><p className="muted small">About “{conv.label}”{conv.disappearSeconds ? " · messages disappear after 24 hours" : ""}</p></div>
        <div className="row">{callOpt?.canStart && !conv.blocked && <>
          <button className="btn accent sm" onClick={startCall} disabled={calling}><Icon name="headset" size={16} />{conv.role === "owner" ? "Call back" : "Call in the app"}</button></>}<button className="iconbtn danger" onClick={block} disabled={conv.blocked} aria-label={conv.blocked ? "Blocked" : "Block"} title={conv.blocked ? "Blocked" : "Block"}><Icon name="block" size={18} /></button><button className="iconbtn" onClick={() => setReporting(!reporting)} aria-label="Report" title="Report" aria-pressed={reporting}><Icon name="flag" size={18} /></button><button className="iconbtn" onClick={verify} aria-label="Verify identity" title="Verify identity" aria-pressed={safetyOpen}><Icon name="shield" size={18} /></button></div></div>}
      {conv && <div className="privacy-note" style={{ marginTop: 10 }}><Icon name="lock" size={16} /><span>
        {conv.role === "owner"
          ? <>@{conv.with} reached you through your link “{conv.label}”. They can't see your number, and you can't see theirs. Either of you can start a call now. If you have PryingEyes open it rings here; if not, you'll get a missed-call notification and can reply in this chat.</>
          : callOpt?.canStart
            ? <>Messages are encrypted and no numbers are shared. Want to talk? <b>Call in the app</b> rings @{conv.with} over the internet, with no phone numbers involved. If they're not in the app, they'll see a missed call.</>
            : <>Messages are encrypted and no numbers are shared.{callOpt?.reason === "pass_gate_again" ? " To call, open the owner's link again — calls need a fresh check and the owner's link must allow them." : ""}</>}
      </span></div>}
      {safetyOpen && <div className="card" style={{ marginTop: 10 }}><p className="muted small" style={{ margin: "0 0 6px" }}>Compare this safety number with @{conv.with} to confirm no one is in the middle.</p><div className="safety-num">{safety || "Loading…"}</div></div>}
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
              <div key={it.c.id} className={`callevent${(it.c.status === "missed" || it.c.status === "cancelled" || it.c.status === "busy") ? " missed" : ""}`}>{callLine(it.c, conv?.role)} · {clock(it.c.at)}</div>
            ) : ((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "flex-end", gap: 6, flexDirection: m.mine ? "row-reverse" : "row" }}>
              {reporting && <input type="checkbox" aria-label="Include in report" checked={picked.includes(m.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, m.id] : picked.filter((x) => x !== m.id))} />}
              <div className={`bubble ${m.mine ? "mine" : "theirs"}`}>
                <MessageText text={m.text} mine={m.mine} />
                {m.attachmentKind === "voice" && m.attachment ? <audio controls src={m.attachment} preload="metadata" className="voice-note" /> : null}
                {m.attachmentKind !== "voice" && m.attachment ? (m.viewOnce && !m.mine ? <ViewOnce src={m.attachment} onConsume={() => api(`/api/chats/${id}/messages/${m.id}/consume`, { method: "POST" }).catch(() => {})} /> : /\.(mp4|mov|m4v)$/.test(m.attachment) ? <video controls src={m.attachment} className="msg-attach video" preload="metadata" /> : <img src={m.attachment} alt="" className="msg-attach" loading="lazy" />) : null}
                <ReactionBar kind="message" targetId={m.id} initial={m.reactions} />
                <div className="tiny" style={{ opacity: .7, marginTop: 2 }}>{clock(m.at)}{m.mine && m.read ? " · read" : ""}</div>
              </div>
            </div>
          ))(it.m))}
        </div>
        {sharing && !conv?.blocked && (
          <div className="card stack small" style={{ marginTop: 10 }} data-testid="share-code-panel">
            <p className="muted" style={{ margin: 0 }}>Your message will include one of your contact codes. Whoever taps it reaches you through PryingEyes, without your number or email.</p>
            <div className="chips">{[1, 2, 3].map((n) => <button type="button" key={n} className="chip" aria-pressed={tier === n} onClick={() => setTier(n)}>{TIER_NAMES[n]}</button>)}</div>
            <KindPicker kind={kind} setKind={setKind} />
          </div>
        )}
        <form onSubmit={send} className="chatbar">
          <button type="button" className="plus" aria-pressed={sharing} onClick={() => setSharing(!sharing)} disabled={conv?.blocked} data-testid="chat-share-code" title="Share my contact code"><Icon name="mark" size={19} /><span className="sr-only">Share my contact code</span></button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
          <button type="button" className="plus" onClick={() => fileRef.current?.click()} disabled={conv?.blocked} title={viewOnce ? "Send a view-once photo" : "Send a photo"}><Icon name="image" size={19} /><span className="sr-only">Send a photo</span></button>
          <button type="button" className="plus" onClick={() => setViewOnce(!viewOnce)} aria-pressed={viewOnce} disabled={conv?.blocked} title={viewOnce ? "View once: on" : "View once: off"}><Icon name={viewOnce ? "eye" : "eyeOff"} size={19} /><span className="sr-only">View once</span></button>
          <button type="button" className={`plus${recording ? " recording" : ""}`} onClick={recording ? stopVoice : startVoice} disabled={conv?.blocked} title={recording ? "Stop recording" : "Record a voice note"} aria-pressed={recording}>{recording ? <><span className="rec-dot" />{recTime}s</> : <Icon name="mic" size={19} />}<span className="sr-only">Voice note</span></button>
          <label htmlFor="msg" className="sr-only">Message</label>
          <input id="msg" type="text" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder={conv?.blocked ? "This conversation is blocked" : "Type a message here…"} disabled={conv?.blocked} />
          <button className="sendbtn" disabled={(!text.trim() && !sharing) || conv?.blocked} aria-label="Send" title="Send"><Icon name="send" size={24} /></button>
        </form>
      </div>
    </div>
  );
}
