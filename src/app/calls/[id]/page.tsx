"use client";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { CallEngine, type EngineState } from "@/components/calls/engine";

const engines = new Map<string, { engine: CallEngine; answered: boolean; leave?: ReturnType<typeof setTimeout> }>();
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const ENDED: Record<string, (who: string, role: string) => string> = {
  ended: () => "Call ended",
  declined: (w, r) => (r === "caller" ? `@${w} couldn't take the call` : "You declined the call"),
  missed: (w, r) => (r === "caller" ? `@${w} didn't answer. They'll see a missed call.` : "Missed call"),
  cancelled: (w, r) => (r === "caller" ? "You cancelled the call" : `@${w} hung up before you answered`),
  busy: (w) => `@${w} is on another call. They'll see that you tried.`,
  failed: () => "The call couldn't be connected",
};

export default function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [s, setS] = useState<EngineState>({ phase: "loading", call: null, error: "", muted: false, connectedAt: null });
  const [now, setNow] = useState(Date.now());
  const engine = useRef<CallEngine | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    // One engine per call, reused across React's development double-mount; leaving the page
    // (navigation or closing the tab) hangs up.
    let entry = engines.get(id);
    if (entry?.leave) { clearTimeout(entry.leave); entry.leave = undefined; }
    if (!entry) {
      entry = { engine: new CallEngine(id, () => undefined), answered: false };
      engines.set(id, entry);
      entry.engine.start();
    }
    const e = entry.engine;
    e.listen((st, remote) => {
      setS(st);
      if (audio.current && remote && audio.current.srcObject !== remote) { audio.current.srcObject = remote; void audio.current.play().catch(() => undefined); }
    });
    engine.current = e;
    if (!entry.answered && new URLSearchParams(window.location.search).get("answer") === "1") { entry.answered = true; void e.accept(); }
    const exit = () => e.hangupOnExit();
    window.addEventListener("pagehide", exit);
    const ent = entry;
    return () => {
      window.removeEventListener("pagehide", exit);
      ent.leave = setTimeout(() => { engines.delete(id); e.hangupOnExit(); }, 250);
    };
  }, [id]);

  // The caller is asked for the microphone while it rings, so the call can start the moment it's answered.
  const role = s.call?.role;
  useEffect(() => { if (role === "caller") void engine.current?.prepareMic(); }, [role]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);

  const c = s.call;
  const ringLeft = c ? Math.max(0, Math.ceil((new Date(c.ringEndsAt).getTime() - now) / 1000)) : 0;
  const talking = s.connectedAt ? (now - s.connectedAt) / 1000 : 0;
  const e = engine.current;

  let status = "Connecting…";
  if (s.phase === "loading") status = "Loading…";
  else if (s.phase === "ringing") status = c?.role === "caller" ? `Ringing @${c.with}…` : `@${c?.with} is calling`;
  else if (s.phase === "connecting") status = "Connecting securely…";
  else if (s.phase === "connected") status = "Connected";
  else if (s.phase === "reconnecting") status = "Reconnecting…";
  else if (s.phase === "ended" && c) status = (ENDED[c.status] ?? ENDED.ended)(c.with, c.role);
  else if (s.phase === "error") status = "Call problem";

  const live = s.phase === "ringing" || s.phase === "connecting" || s.phase === "connected" || s.phase === "reconnecting";
  return (
    <div className="narrow" style={{ maxWidth: 480 }}>
      <div className="callscreen" role="status" aria-live="polite">
        <div className="small" style={{ color: "#AEB9CA" }}>In-app call{c ? ` about “${c.label}”` : ""}</div>
        <div style={{ fontSize: "1.5rem", fontWeight: 800, margin: "6px 0 2px" }}>{c ? `@${c.with}` : "…"}</div>
        <div data-testid="call-status">{status}</div>
        <div className="timer" role="timer">{s.phase === "connected" || s.phase === "reconnecting" ? fmt(talking) : s.phase === "ringing" ? `0:${String(ringLeft).padStart(2, "0")}` : c?.durationSec ? fmt(c.durationSec) : "—"}</div>

        {s.error && <div className="alert err" role="alert" style={{ textAlign: "left" }}>{s.error}</div>}

        {s.phase === "ringing" && c?.role === "caller" && (
          <p className="small" style={{ background: "rgba(255,255,255,.1)", padding: "8px 12px", borderRadius: 14 }}>
            {c.ownerOnline ? `@${c.with} has PryingEyes open — it's ringing on their screen.`
              : `@${c.with} doesn't have PryingEyes open right now. We'll keep ringing for ${ringLeft} s; if they don't pick up, they'll see a missed call and can reply in the chat.`}
          </p>
        )}

        <div className="callbtn-row" style={{ marginTop: 16 }}>
          {s.phase === "ringing" && c?.role === "owner" && <>
            <span><button className="callbtn answer" onClick={() => e?.accept()} aria-label="Answer" title="Answer"><Icon name="call" size={26} /></button><span className="lbl" aria-hidden="true">{"Answer"}</span></span>
            <span><button className="callbtn hangup" onClick={() => e?.hangup()} aria-label="Decline" title="Decline"><Icon name="hangup" size={26} /></button><span className="lbl" aria-hidden="true">{"Decline"}</span></span>
          </>}
          {live && !(s.phase === "ringing" && c?.role === "owner") && <>
            {s.phase !== "ringing" && <span><button className="callbtn" onClick={() => e?.toggleMute()} aria-label={s.muted ? "Unmute" : "Mute"} title={s.muted ? "Unmute" : "Mute"} aria-pressed={s.muted}><Icon name={s.muted ? "micOff" : "mic"} size={26} /></button><span className="lbl" aria-hidden="true">{s.muted ? "Unmute" : "Mute"}</span></span>}
            <span><button className="callbtn hangup" onClick={() => e?.hangup()} aria-label={s.phase === "ringing" ? "Cancel" : "Hang up"} title={s.phase === "ringing" ? "Cancel" : "Hang up"}><Icon name="hangup" size={26} /></button><span className="lbl" aria-hidden="true">{s.phase === "ringing" ? "Cancel" : "Hang up"}</span></span>
          </>}
        </div>

        {(s.phase === "ended" || s.phase === "error") && (
          <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
            {c?.conversationId && <Link className="btn ghost" href={`/chats/${c.conversationId}`}><Icon name="chat" size={16} />Send a message</Link>}
            <Link className="btn ghost" href={c?.role === "owner" ? "/dashboard" : "/chats"}>Done</Link>
          </div>
        )}

        <p className="tiny" style={{ color: "#AEB9CA", marginTop: 14 }}>
          Over the internet, encrypted between your two devices. No phone numbers are used, your IP addresses are hidden by
          the PryingEyes relay, and calls are never recorded. Uses about 0.3 MB of data per minute.
        </p>
      </div>
      <audio ref={audio} autoPlay playsInline />
    </div>
  );
}
