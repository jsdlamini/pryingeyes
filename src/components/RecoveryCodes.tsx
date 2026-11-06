"use client";
import { Icon } from "./Icon";
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone?: () => void }) {
  const download = () => {
    const blob = new Blob([`PryingEyes recovery codes\nEach code works once. Keep them somewhere safe and offline.\n\n${codes.join("\n")}\n`], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "pryingeyes-recovery-codes.txt"; a.click();
  };
  return (
    <div className="stack">
      <div className="alert warn">Save these recovery codes now — you won't see them again. Each works once if you lose your passkey or phone.</div>
      <div className="recovery" aria-label="Recovery codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
      <div className="row noprint">
        <button className="btn ghost sm" onClick={download}><Icon name="download" size={16} />Download</button>
        <button className="btn ghost sm" onClick={() => window.print()}><Icon name="print" size={16} />Print</button>
        <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}><Icon name="copy" size={16} />Copy</button>
        {onDone && <button className="btn sm" onClick={onDone}>I've saved them</button>}
      </div>
    </div>
  );
}
