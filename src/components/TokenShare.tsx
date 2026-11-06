"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Icon } from "@/components/Icon";

export function TokenShare({ link, short, label }: { link: string; short: string; label?: string }) {
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState("");
  useEffect(() => { QRCode.toDataURL(link, { margin: 1, width: 240, errorCorrectionLevel: "M" }).then(setQr); }, [link]);
  const copy = async (v: string, what: string) => { await navigator.clipboard?.writeText(v); setCopied(what); setTimeout(() => setCopied(""), 1800); };
  const downloadQr = () => { const a = document.createElement("a"); a.href = qr; a.download = `pryingeyes-${(label ?? "code").replace(/\W+/g, "-")}.png`; a.click(); };
  return (
    <div className="stack">
      <div className="alert warn"><b>Copy or download these now.</b> We only keep a fingerprint of the code, so we can't show it again. If you lose it, rotate the token for a new one.</div>
      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="stack">
          <div><label>Share link</label><div className="codebox" data-testid="share-link">{link}</div>
            <button className="btn sm" style={{ marginTop: 6 }} onClick={() => copy(link, "link")}><Icon name={copied === "link" ? "check" : "link"} size={16} />{copied === "link" ? "Copied" : "Copy link"}</button></div>
          <div><label>Short code (for platforms without links)</label><div className="codebox" data-testid="share-short">{short}</div>
            <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => copy(short, "short")}><Icon name={copied === "short" ? "check" : "copy"} size={16} />{copied === "short" ? "Copied" : "Copy code"}</button></div>
        </div>
        <div style={{ textAlign: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr && <img src={qr} alt={`QR code for ${label ?? "this token"}`} width={200} height={200} style={{ background: "#fff", padding: 6, borderRadius: 8 }} />}
          <div><button className="btn ghost sm" onClick={downloadQr} disabled={!qr}><Icon name="download" size={16} />Download QR</button></div>
        </div>
      </div>
      <p className="muted small">The code contains nothing about your number. Revoke it any time.</p>
    </div>
  );
}
