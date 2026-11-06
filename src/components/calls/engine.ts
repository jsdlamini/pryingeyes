/**
 * Browser side of an in-app call. Plain WebRTC (no SDK): one RTCPeerConnection, audio only,
 * forced through our TURN relay when the server says so (iceTransportPolicy "relay"), so neither
 * device learns the other's IP address. Signalling goes through /api/calls/[id]/signal, which is
 * also the heartbeat. The same HTTP contract is what native apps will use.
 */
export type CallView = {
  id: string; role: "caller" | "owner"; with: string; label: string;
  status: "ringing" | "accepted" | "ended" | "declined" | "missed" | "cancelled" | "busy" | "failed";
  endedBy: string | null; answeredAt: string | null; durationSec: number; ringEndsAt: string;
  otherConnected: boolean; ownerOnline?: boolean; conversationId: string | null; requestId: string | null;
};
export type Phase = "loading" | "ringing" | "connecting" | "connected" | "reconnecting" | "ended" | "error";
type Signal = { type: "offer" | "answer"; sdp: string } | { type: "ice"; candidate: RTCIceCandidateInit } | { type: "restart" };

const TERMINAL = ["ended", "declined", "missed", "cancelled", "busy", "failed"];

export interface EngineState { phase: Phase; call: CallView | null; error: string; muted: boolean; connectedAt: number | null }

async function req<T = any>(url: string, body?: unknown, keepalive = false): Promise<T> {
  const r = await fetch(url, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.message ?? "Something went wrong."), { code: j?.error });
  return j as T;
}

export class CallEngine {
  state: EngineState = { phase: "loading", call: null, error: "", muted: false, connectedAt: null };
  remote: MediaStream | null = null;
  private pc: RTCPeerConnection | null = null;
  private local: MediaStream | null = null;
  private pending: Signal[] = [];
  private pendingIce: RTCIceCandidateInit[] = [];
  private settingUp = false;
  private restarted = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private busy = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private id: string, private onChange: (s: EngineState, remote: MediaStream | null) => void) {}

  /** Replaces the listener (the page may re-mount) and replays the current state to it. */
  listen(fn: (s: EngineState, remote: MediaStream | null) => void) { this.onChange = fn; fn(this.state, this.remote); }

  private set(p: Partial<EngineState>) { this.state = { ...this.state, ...p }; this.onChange(this.state, this.remote); }
  private fail(msg: string) { this.set({ phase: "error", error: msg }); }

  start() { this.stopped = false; void this.loop(); }

  /** Asks for the microphone early (the caller does this while it rings). */
  async prepareMic() {
    if (this.local) return true;
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      return true;
    } catch {
      this.fail("PryingEyes needs your microphone for calls. Allow it in your browser's site settings, then try again.");
      return false;
    }
  }

  async accept() {
    if (!(await this.prepareMic())) { await this.hangup(); return; }
    try { this.set({ call: await req(`/api/calls/${this.id}`, { action: "accept" }) }); }
    catch (e) { this.fail(e instanceof Error ? e.message : "Couldn't answer."); }
  }

  async hangup() {
    try { const v = await req<CallView>(`/api/calls/${this.id}`, { action: "hangup" }); this.apply(v); }
    catch { /* the server ends dead calls by itself */ }
    this.teardown();
  }

  /** Best effort when the page is closed mid-call. */
  hangupOnExit() {
    const c = this.state.call;
    if (c && !TERMINAL.includes(c.status)) void req(`/api/calls/${this.id}`, { action: "hangup" }, true).catch(() => undefined);
    this.teardown();
  }

  toggleMute() {
    const muted = !this.state.muted;
    this.local?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    this.set({ muted });
  }

  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); }

  private teardown() {
    this.stop();
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    try { this.pc?.close(); } catch { /* ignore */ }
    this.pc = null;
  }

  private apply(call: CallView) {
    let phase = this.state.phase;
    if (TERMINAL.includes(call.status)) phase = "ended";
    else if (call.status === "ringing") phase = "ringing";
    else if (phase === "loading" || phase === "ringing") phase = "connecting";
    if (this.state.phase === "error") phase = "error";
    this.set({ call, phase });
  }

  private async loop() {
    if (this.stopped) return;
    if (!this.busy) {
      this.busy = true;
      try {
        const { call, signals } = await req<{ call: CallView; signals: Signal[] }>(`/api/calls/${this.id}/signal`);
        this.apply(call);
        if (TERMINAL.includes(call.status)) { this.teardown(); return; }
        this.pending.push(...signals);
        if (call.status === "accepted" && !this.pc && !this.settingUp) await this.setup(call.role);
        if (this.pc) await this.drain();
      } catch (e) {
        if ((e as { code?: string }).code === "call_not_found") { this.fail("This call isn't available."); this.teardown(); return; }
      } finally { this.busy = false; }
    }
    const fast = this.state.phase !== "connected";
    this.timer = setTimeout(() => void this.loop(), fast ? 900 : 2000);
  }

  private async setup(role: "caller" | "owner") {
    this.settingUp = true;
    try {
      if (!(await this.prepareMic())) { await this.hangup(); return; }
      const ice = await req<{ iceServers: RTCIceServer[]; iceTransportPolicy: RTCIceTransportPolicy; configured: boolean }>("/api/calls/ice");
      if (ice.iceTransportPolicy === "relay" && !ice.configured) {
        this.fail("Calling isn't set up on this server yet (the TURN relay is missing).");
        await this.hangup(); return;
      }
      const pc = new RTCPeerConnection({ iceServers: ice.iceServers, iceTransportPolicy: ice.iceTransportPolicy, bundlePolicy: "max-bundle" });
      this.pc = pc;
      this.local!.getTracks().forEach((t) => pc.addTrack(t, this.local!));
      pc.ontrack = (ev) => { this.remote = ev.streams[0] ?? new MediaStream([ev.track]); this.onChange(this.state, this.remote); };
      pc.onicecandidate = (ev) => {
        if (ev.candidate) void req(`/api/calls/${this.id}/signal`, { type: "ice", candidate: ev.candidate.toJSON() }).catch(() => undefined);
      };
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === "connected") this.set({ phase: "connected", connectedAt: this.state.connectedAt ?? Date.now() });
        else if (s === "disconnected") this.set({ phase: "reconnecting" });
        else if (s === "failed") void this.recover();
      };
      // If audio can't flow within 20 s (relay unreachable, very poor network), say so instead of hanging.
      this.connectTimer = setTimeout(() => {
        if (this.state.phase === "connecting") { this.fail("We couldn't connect the call. Check your internet connection and try again, or send a message instead."); void this.hangup(); }
      }, 20_000);
      if (role === "caller") await this.offer(false);
    } catch (e) {
      this.fail(e instanceof Error ? e.message : "The call couldn't be set up.");
      await this.hangup();
    } finally { this.settingUp = false; }
  }

  private async offer(iceRestart: boolean) {
    const pc = this.pc!;
    const o = await pc.createOffer({ iceRestart });
    await pc.setLocalDescription(o);
    await req(`/api/calls/${this.id}/signal`, { type: "offer", sdp: pc.localDescription!.sdp });
  }

  /** One ICE restart (e.g. switching from Wi‑Fi to mobile data), then give up. */
  private async recover() {
    if (this.restarted) { this.fail("The connection was lost."); await this.hangup(); return; }
    this.restarted = true;
    this.set({ phase: "reconnecting" });
    try {
      if (this.state.call?.role === "caller") await this.offer(true);
      else await req(`/api/calls/${this.id}/signal`, { type: "restart" });
    } catch { this.fail("The connection was lost."); await this.hangup(); }
  }

  private async drain() {
    const pc = this.pc!;
    while (this.pending.length) {
      const s = this.pending.shift()!;
      try {
        if (s.type === "offer") {
          await pc.setRemoteDescription({ type: "offer", sdp: s.sdp });
          await this.flushIce();
          const a = await pc.createAnswer();
          await pc.setLocalDescription(a);
          await req(`/api/calls/${this.id}/signal`, { type: "answer", sdp: pc.localDescription!.sdp });
        } else if (s.type === "answer") {
          if (pc.signalingState === "have-local-offer") { await pc.setRemoteDescription({ type: "answer", sdp: s.sdp }); await this.flushIce(); }
        } else if (s.type === "ice") {
          if (pc.remoteDescription) await pc.addIceCandidate(s.candidate).catch(() => undefined);
          else this.pendingIce.push(s.candidate);
        } else if (s.type === "restart" && this.state.call?.role === "caller") {
          await this.offer(true);
        }
      } catch { /* a bad message shouldn't end the call; ICE failure will surface via connectionState */ }
    }
  }

  private async flushIce() {
    const pc = this.pc!;
    for (const c of this.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => undefined);
  }
}
