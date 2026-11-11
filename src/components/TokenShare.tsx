"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Icon } from "@/components/Icon";

const TEXTS: { label: string; text: (l: string) => string }[] = [
  { label: "WhatsApp about / status", text: (l) => `No number needed. Reach me here: ${l}` },
  { label: "Instagram / TikTok bio", text: (l) => `📩 Enquiries: ${l}` },
  { label: "Classifieds / marketplace", text: (l) => `Contact me through PryingEyes (no number needed): ${l}` },
];

export function TokenShare({ link, short, label, onSavedChange }: { link: string; short: string; label?: string; onSavedChange?: (saved: boolean) => void }) {
  const [qr, setQr] = useState("");
  const [qrSvg, setQrSvg] = useState("");
  const [qrPoster, setQrPoster] = useState("");
  const [copied, setCopied] = useState("");
  const [saved, setSaved] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 240, errorCorrectionLevel: "M" }).then(setQr);
    QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(setQrSvg);
    QRCode.toDataURL(link, { margin: 2, width: 1024, errorCorrectionLevel: "M" }).then(setQrPoster);
  }, [link]);
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
  const whatsapp = () => { window.open(`https://wa.me/?text=${encodeURIComponent(`No number needed. Reach me here: ${link}`)}`, "_blank", "noopener"); kept(); };
  const download = (href: string, name: string) => { const a = document.createElement("a"); a.href = href; a.download = name; a.click(); kept(); };
  const print = () => { kept(); window.print(); };

  return (
    <div className="stack">
      <div className="alert warn"><b>You won't see this code again.</b> We only keep a fingerprint of it, so copy, share or save it now. Lost it later? Replace the code for a new one.</div>

      {/* Printable card (only shown when printing) */}
      <div className="print-card">
        <div className="print-card-head">PryingEyes{label ? ` · ${label}` : ""}</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {qrPoster && <img src={qrPoster} alt="QR code" />}
        <div className="print-card-code">{short}</div>
        <div className="print-card-line">Scan to contact me. No number needed.</div>
      </div>

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
        <button className="btn ghost" onClick={whatsapp}><Icon name="share" size={16} />WhatsApp</button>
        <button className="btn ghost" onClick={print}><Icon name="print" size={16} />Print card</button>
      </div>

      <div className="share-texts">
        <span className="muted small"><b>Ready to paste</b></span>
        {TEXTS.map((t) => (
          <button key={t.label} className="btn ghost sm" onClick={() => copy(t.text(link), t.label)}>
            <Icon name={copied === t.label ? "check" : "copy"} size={15} />{copied === t.label ? "Copied" : t.label}
          </button>
        ))}
      </div>

      <div className="share-texts">
        <span className="muted small"><b>Download QR</b></span>
        <div className="row">
          <button className="btn ghost sm" onClick={() => download(qr, `pryingeyes-${(label ?? "code").replace(/\W+/g, "-")}-small.png`)} disabled={!qr}><Icon name="download" size={15} />Small PNG</button>
          <button className="btn ghost sm" onClick={() => download(qrPoster, `pryingeyes-${(label ?? "code").replace(/\W+/g, "-")}-poster.png`)} disabled={!qrPoster}><Icon name="download" size={15} />Poster PNG</button>
          <button className="btn ghost sm" onClick={() => download("data:image/svg+xml;utf8," + encodeURIComponent(qrSvg), `pryingeyes-${(label ?? "code").replace(/\W+/g, "-")}.svg`)} disabled={!qrSvg}><Icon name="download" size={15} />SVG</button>
        </div>
      </div>

      <p className="muted small">The code contains nothing about your number. Pause or replace it any time.</p>
    </div>
  );
}
