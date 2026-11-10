"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Icon } from "@/components/Icon";

/**
 * Shows a new code once. We only keep a fingerprint of it, so the owner must keep it now: `onSavedChange`
 * reports whether they have copied, shared or downloaded it, and pages keep "Done" disabled until then.
 */
export function TokenShare({ link, short, label, onSavedChange }: { link: string; short: string; label?: string; onSavedChange?: (saved: boolean) => void }) {
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState("");
  const [saved, setSaved] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { QRCode.toDataURL(link, { margin: 1, width: 240, errorCorrectionLevel: "M" }).then(setQr); }, [link]);
  useEffect(() => { setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"); }, []);
  useEffect(() => { onSavedChange?.(saved); }, [saved, onSavedChange]);
  const kept = () => setSaved(true);
  const copy = async (v: string, what: string) => {
    try { await navigator.clipboard?.writeText(v); kept(); setCopied(what); setTimeout(() => setCopied(""), 1800); } catch { /* clipboard blocked: the text is still selectable */ }
  };
  const share = async () => {
    try { await navigator.share({ title: label ? `Reach me: ${label}` : "Reach me on PryingEyes", text: "Tap to reach me without my phone number:", url: link }); kept(); }
    catch { /* cancelled */ }
  };
  const downloadQr = () => { const a = document.createElement("a"); a.href = qr; a.download = `pryingeyes-${(label ?? "code").replace(/\W+/g, "-")}.png`; a.click(); kept(); };
  return (
    <div className="stack">
      <div className="alert warn"><b>You won't see this code again.</b> We only keep a fingerprint of it, so copy, share or save it now. Lost it later? Replace the code for a new one.</div>
      <div className="code-pass" aria-label="Your new code">
        <div className="code-pass-body">
          <span className="code-pass-kicker">Contact code{label ? ` · ${label}` : ""}</span>
          <span className="code-pass-code" data-testid="share-short">{short}</span>
          <span className="code-pass-link" data-testid="share-link">{link}</span>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {qr && <img src={qr} alt={`QR code for ${label ?? "this code"}`} width={120} height={120} className="code-pass-qr" />}
      </div>
      <div className="share-actions">
        <button className="btn ghost" onClick={() => copy(link, "link")}><Icon name={copied === "link" ? "check" : "link"} size={16} />{copied === "link" ? "Copied" : "Copy link"}</button>
        {canShare
          ? <button className="btn accent" onClick={share}><Icon name="share" size={16} />Share</button>
          : <button className="btn ghost" onClick={() => copy(short, "short")}><Icon name={copied === "short" ? "check" : "copy"} size={16} />{copied === "short" ? "Copied" : "Copy code"}</button>}
        <button className="btn ghost" onClick={downloadQr} disabled={!qr}><Icon name="download" size={16} />Save QR</button>
      </div>
      <p className="muted small">The code contains nothing about your number. Pause or replace it any time.</p>
    </div>
  );
}
