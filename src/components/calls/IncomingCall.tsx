"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

type Incoming = { id: string; from: string; label: string; ringEndsAt: string };

/** Short two-tone ring using Web Audio (no audio files). Browsers may block it until the page has been clicked. */
function ringer() {
  let ctx: AudioContext | null = null; let timer: ReturnType<typeof setInterval> | null = null;
  const beep = () => {
    if (!ctx) return;
    for (const [f, at] of [[880, 0], [660, 0.25]] as const) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; g.gain.value = 0.06; o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.2);
    }
  };
  return {
    start() { try { ctx = new AudioContext(); beep(); timer = setInterval(beep, 2000); } catch { /* no audio */ } },
    stop() { if (timer) clearInterval(timer); timer = null; void ctx?.close().catch(() => undefined); ctx = null; },
  };
}

/**
 * Rings on any page while PryingEyes is open. When the app is closed nothing can ring in a browser,
 * so the server records a missed call instead (native apps will receive a VoIP push here).
 */
export function IncomingCall() {
  const path = usePathname();
  const router = useRouter();
  const [call, setCall] = useState<Incoming | null>(null);
  const ring = useRef<ReturnType<typeof ringer> | null>(null);
  const onCallPage = path.startsWith("/calls/");

  useEffect(() => {
    if (onCallPage) return;
    let alive = true;
    const poll = () => fetch("/api/calls/incoming", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setCall(j.call); }).catch(() => undefined);
    poll();
    const t = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [onCallPage]);

  const id = call?.id;
  useEffect(() => {
    if (!id) return;
    const r = ringer(); ring.current = r; r.start();
    const title = document.title; let flip = false;
    const t = setInterval(() => { flip = !flip; document.title = flip ? "Incoming call" : title; }, 1000);
    return () => { r.stop(); clearInterval(t); document.title = title; };
  }, [id]);

  if (!call || onCallPage) return null;
  const decline = async () => {
    setCall(null);
    await fetch(`/api/calls/${call.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "decline" }) }).catch(() => undefined);
  };
  return (
    <div className="incoming" role="alertdialog" aria-labelledby="inc-title" aria-describedby="inc-desc">
      <div>
        <b id="inc-title">@{call.from} is calling</b>
        <div id="inc-desc" className="small">In-app call about “{call.label}”. No numbers are shared.</div>
      </div>
      <div className="row">
        <button className="callbtn answer" style={{ width: 46, height: 46 }} onClick={() => { ring.current?.stop(); router.push(`/calls/${call.id}?answer=1`); }} aria-label="Answer" title="Answer"><Icon name="call" size={20} /></button>
        <button className="callbtn hangup" style={{ width: 46, height: 46 }} onClick={decline} aria-label="Decline" title="Decline"><Icon name="hangup" size={20} /></button>
      </div>
    </div>
  );
}
