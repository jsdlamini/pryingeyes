"use client";
import { useEffect, useState } from "react";

/** Live microphone level meter (segments light up as you speak). */
export function MicMeter({ stream }: { stream: MediaStream | null }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream) { setLevel(0); return; }
    let ctx: AudioContext | null = null;
    let raf = 0;
    let cancelled = false;
    try {
      ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (cancelled) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4.5));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch { /* audio analysis unsupported */ }
    return () => { cancelled = true; cancelAnimationFrame(raf); void ctx?.close().catch(() => {}); };
  }, [stream]);

  const segs = 14;
  const lit = Math.round(level * segs);
  return (
    <div className="micmeter">
      <span className="micmeter-label">Mic</span>
      <div className="micmeter-bars" aria-hidden="true">
        {Array.from({ length: segs }).map((_, i) => (
          <span key={i} className={i < lit ? "on" : ""} />
        ))}
      </div>
      <span className="micmeter-tip">{level > 0.05 ? "Audio OK" : "Speak to test"}</span>
    </div>
  );
}

/** Connection quality badge from WebRTC stats (RTT + packet loss). */
export function ConnQuality({ pc }: { pc: RTCPeerConnection | null }) {
  const [q, setQ] = useState<{ label: string; cls: string } | null>(null);
  useEffect(() => {
    if (!pc) { setQ(null); return; }
    const probe = async () => {
      try {
        const stats = await pc.getStats();
        let rtt = 0, lost = 0, total = 0, saw = false;
        stats.forEach((s: any) => {
          if (s.type === "candidate-pair" && s.state === "succeeded") { rtt = Math.max(rtt, s.currentRoundTripTime ?? 0); saw = true; }
          if (s.type === "inbound-rtp" && s.kind === "audio") { lost += s.packetsLost ?? 0; total += s.packetsReceived ?? 0; }
        });
        const loss = total > 0 ? lost / (lost + total) : 0;
        let label = "Good", cls = "good";
        if (loss > 0.08 || (saw && rtt > 0.5)) { label = "Poor"; cls = "poor"; }
        else if (loss > 0.03 || (saw && rtt > 0.25)) { label = "Fair"; cls = "fair"; }
        setQ({ label, cls });
      } catch { /* stats unavailable */ }
    };
    void probe();
    const id = setInterval(probe, 2000);
    return () => clearInterval(id);
  }, [pc]);
  if (!q) return null;
  return <span className={`quality ${q.cls}`}><span className="quality-dot" />{q.label} connection</span>;
}
