"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "./api";

/** One-off growth prompt: shown after a first successful contact, only to people without a code. */
export function GrowthLoopPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/api/me").then((m) => { if (m.user?.loopPrompt === "shown" && !m.user.hasCode) setShow(true); }).catch(() => undefined);
  }, []);
  async function dismiss() {
    setShow(false); setBusy(true);
    try { await api("/api/growth/dismiss", { body: {} }); } catch { /* best-effort */ }
    finally { setBusy(false); }
  }
  if (!show) return null;
  return (
    <div className="card loop-prompt" role="status">
      <p style={{ margin: 0 }}><b>You just reached someone without seeing their number. Want a code like this for yourself?</b></p>
      <div className="row" style={{ marginTop: 10 }}>
        <Link className="btn sm" href="/dashboard/tokens/new?quick=1">Make my code</Link>
        <button type="button" className="btn ghost sm" onClick={dismiss} disabled={busy}>Not now</button>
      </div>
    </div>
  );
}
