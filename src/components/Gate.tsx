"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, errMsg } from "./api";
import { Captcha } from "./Captcha";
import { Tier } from "./Tier";
import { Icon } from "./Icon";
import { t } from "@/i18n";

type View =
  | { status: "unavailable" } | { status: "limited"; retryAfter: number } | { status: "captcha_failed" } | { status: "otp_wrong" }
  | { status: "ok"; requestId: string; tier: number; label: string; step: "otp" | "consent" | "waiting" | "choose"; options: ("reveal" | "chat" | "app_call")[]; otpSent: boolean; consentExpiresAt?: string | null };

/** s•••@example.com — enough for the caller to know which inbox to check, nothing more on screen. */
export const maskEmail = (e: string | null | undefined) => {
  const [user, domain] = (e ?? "").split("@");
  return user && domain ? `${user[0]}•••@${domain}` : null;
};

export function Gate(p: { code?: string; requestId?: string; signedIn: boolean; handle: string | null; email?: string | null; captchaMode: "dev" | "turnstile"; siteKey?: string }) {
  const [view, setView] = useState<View | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [code, setCode] = useState(""); const [note, setNote] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<{ url: string; left: number } | null>(null);
  const onToken = useCallback((tk: string | null) => setCaptcha(tk), []);

  const requestId = view && view.status === "ok" ? view.requestId : p.requestId;

  // Resume by request id (notification link), and poll while waiting for the owner.
  useEffect(() => { if (p.requestId) api(`/api/gate/${p.requestId}`).then(setView).catch((e) => setErr(errMsg(e))); }, [p.requestId]);
  useEffect(() => {
    if (!(view?.status === "ok" && view.step === "waiting")) return;
    const id = setInterval(() => api(`/api/gate/${view.requestId}`).then(setView).catch(() => undefined), 5000);
    return () => clearInterval(id);
  }, [view]);
  // Reveal countdown — the image is dropped from memory after 60 s.
  useEffect(() => {
    if (!reveal) return;
    if (reveal.left <= 0) { URL.revokeObjectURL(reveal.url); setReveal(null); return; }
    const id = setTimeout(() => setReveal((r) => r && { ...r, left: r.left - 1 }), 1000);
    return () => clearTimeout(id);
  }, [reveal]);

  async function run<T>(fn: () => Promise<T>) { setBusy(true); setErr(""); try { return await fn(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); } }

  const start = () => run(async () => setView(await api("/api/gate/start", { body: { code: p.code, captcha } })));
  // Auto-continue once the human check passes — no need to tap Continue.
  const startedRef = useRef(false);
  useEffect(() => {
    if (captcha && !view && !startedRef.current) { startedRef.current = true; void start(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captcha, view]);
  const sendOtp = () => run(async () => setView(await api(`/api/gate/${requestId}/otp`, { body: { action: "send" } })));
  const verifyOtp = (e: React.FormEvent) => { e.preventDefault(); return run(async () => {
    const r = await api(`/api/gate/${requestId}/otp`, { body: { action: "verify", code } });
    if (r.status === "otp_wrong") { setErr(t("gate.otp.wrong")); setCode(""); } else setView(r);
  }); };
  const askOwner = (e: React.FormEvent) => { e.preventDefault(); return run(async () => setView(await api(`/api/gate/${requestId}/consent`, { body: { note } }))); };
  const choose = (choice: "reveal" | "chat" | "app_call") => run(async () => {
    const r = await api(`/api/gate/${requestId}/outcome`, { body: { choice } });
    if (r.status && r.status !== "ok") { setView(r); return; }
    if (r.revealUrl) {
      const res = await fetch(r.revealUrl, { cache: "no-store" });
      if (!res.ok) throw new Error("This view has expired.");
      setReveal({ url: URL.createObjectURL(await res.blob()), left: 60 });
    }
    if (r.conversationId) window.location.href = `/chats/${r.conversationId}`;
    if (r.appCallId) { window.location.href = `/calls/${r.appCallId}`; return; }
    setView(r);
  });

  if (!p.signedIn) return (
    <div className="card stack">
      <span className="muted small">{t("gate.reaching")} someone on PryingEyes</span>
      <h1>{t("gate.signin")}</h1>
      <p className="muted small">{t("gate.signin.why")}</p>
      <Link className="btn block" href={`/signup?next=${encodeURIComponent(`/t/${p.code}`)}`} data-testid="gate-signup">Create an account</Link>
      <Link className="btn ghost block" href={`/login?next=${encodeURIComponent(`/t/${p.code}`)}`}>Sign in</Link>
      <p className="small muted">You&apos;ll come straight back to this code. They see your handle, never your email.</p>
    </div>
  );

  if (view && view.status !== "ok" && view.status !== "otp_wrong") return (
    <div className="card" role="status">
      {view.status === "limited" ? <><h1>Please wait</h1><p>{t("gate.limited")} ({Math.ceil(view.retryAfter / 60)} min)</p></>
        : view.status === "captcha_failed" ? <><h1>Try again</h1><p>{t("gate.captcha_failed")}</p><button className="btn" onClick={() => setView(null)}>Back</button></>
        : <><h1>{t("gate.unavailable.title")}</h1><p className="muted">{t("gate.unavailable.body")}</p><Link className="btn ghost" href="/">Home</Link></>}
    </div>
  );

  const v = view?.status === "ok" ? view : null;
  const stepIdx = !v ? 1 : v.step === "otp" ? 2 : v.step === "consent" || v.step === "waiting" ? 3 : 4;
  return (
    <div className="stack">
      <div className="card">
        <span className="muted small">{t("gate.reaching")}</span>
        <h1 style={{ margin: "2px 0 6px" }}>{v ? v.label : "someone on PryingEyes"}</h1>
        {v && <Tier n={v.tier} />}
      </div>
      <div className="card stack">
        {err && <div className="alert err" role="alert">{err}</div>}
        <ol className="steps" aria-label="Progress">
          <li className="done"><span className="dot"><Icon name="check" size={14} /></span>{t("gate.step.signedin")} as @{p.handle}</li>
          <li className={stepIdx > 1 ? "done" : "cur"}><span className="dot">{stepIdx > 1 ? <Icon name="check" size={14} /> : "2"}</span>{stepIdx > 1 ? t("gate.step.human") : t("gate.step.human.todo")}</li>
          {(!v || v.tier >= 2) && <li className={stepIdx > 2 ? "done" : stepIdx === 2 ? "cur" : ""}><span className="dot">{stepIdx > 2 ? <Icon name="check" size={14} /> : "3"}</span>{stepIdx > 2 ? t("gate.step.code") : t("gate.step.code.todo")}</li>}
          {(!v || v.tier === 3) && <li className={stepIdx > 3 ? "done" : stepIdx === 3 ? "cur" : ""}><span className="dot">{stepIdx > 3 ? <Icon name="check" size={14} /> : "4"}</span>{stepIdx > 3 ? t("gate.step.asked") : t("gate.step.ask")}</li>}
        </ol>

        {!v && <>
          <Captcha mode={p.captchaMode} siteKey={p.siteKey} onToken={onToken} />
          <button className="btn block" onClick={start} disabled={busy || !captcha}>{t("gate.continue")}</button>
        </>}

        {v?.step === "otp" && (!v.otpSent ? <>
          <p className="small muted">We&apos;ll email a 6-digit code{maskEmail(p.email) ? <> to <b>{maskEmail(p.email)}</b></> : null}. Nothing is sent to your phone, and the person you&apos;re reaching never sees your email.</p>
          <button className="btn block" onClick={sendOtp} disabled={busy}>{t("gate.otp.send")}</button>
        </> : (
          <form onSubmit={verifyOtp}>
            <p className="small muted">{maskEmail(p.email) ? <>We emailed a 6-digit code to <b>{maskEmail(p.email)}</b>. It works for 10 minutes.</> : t("gate.otp.sent")}</p>
            <label htmlFor="g-otp">Code</label>
            <input id="g-otp" className="otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            <div className="row" style={{ marginTop: 10 }}><button className="btn" disabled={busy || code.length !== 6}>{t("gate.otp.verify")}</button><button type="button" className="linkbtn small" onClick={sendOtp}>Send a new code</button></div>
          </form>))}

        {v?.step === "consent" && (
          <form onSubmit={askOwner}>
            <label htmlFor="g-note">{t("gate.consent.note")}</label>
            <textarea id="g-note" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Say who you are and why you're getting in touch." />
            <p className="hint" style={{ textAlign: "right" }}>{note.length} / 280</p>
            <button className="btn block" disabled={busy}>{t("gate.consent.send")}</button>
          </form>)}

        {v?.step === "waiting" && <div role="status"><h2>{t("gate.consent.waiting")}</h2><p className="muted small">{t("gate.consent.waiting.body")}</p>
          <div className="alert info small" style={{ marginTop: 10 }}><b>No need to wait here.</b> You can close this page. If they say yes, we&apos;ll email you a link that brings you straight back.</div></div>}

        {v?.step === "choose" && !reveal && <>
          <h2>{t("gate.choose")}</h2>
          <p className="small muted">You've passed the checks. Choose how to get in touch. Calls and chats never show either person's number.</p>
          <div>
            {v.options.includes("app_call") && <button className="choice" onClick={() => choose("app_call")} disabled={busy}>
              <span className="ico"><Icon name="headset" /></span>
              <span><b>{t("gate.appcall")}</b><span className="d">{t("gate.appcall.desc")}</span></span></button>}
            {v.options.includes("chat") && <button className="choice" onClick={() => choose("chat")} disabled={busy}>
              <span className="ico"><Icon name="chat" /></span>
              <span><b>{t("gate.chat")}</b><span className="d">{t("gate.chat.desc")}{v.tier === 3 ? " " + t("gate.chat.disappear") : ""}</span></span></button>}
            {v.options.includes("reveal") && <button className="choice" onClick={() => choose("reveal")} disabled={busy}>
              <span className="ico"><Icon name="eye" /></span>
              <span><b>{t("gate.reveal")}</b><span className="d">{t("gate.reveal.desc")}</span></span></button>}
          </div>
          {!v.options.includes("app_call") && <p className="hint">The owner hasn't allowed calls on this code.</p>}
        </>}

        {reveal && <div className="stack">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="revealbox"><img src={reveal.url} alt="The owner's phone number, watermarked with your handle" /></div>
          <p className="small" role="timer">{t("gate.reveal.hidden")} <b>0:{String(reveal.left).padStart(2, "0")}</b></p>
          <p className="hint">{t("gate.reveal.logged")}</p>
        </div>}

        <p className="hint">{t("gate.privacy")}</p>
      </div>
      {v && <p className="small" style={{ textAlign: "center" }}><Link href={`/report?request=${v.requestId}`} style={{ color: "var(--bad)" }}>{t("common.report")}</Link></p>}
    </div>
  );
}
