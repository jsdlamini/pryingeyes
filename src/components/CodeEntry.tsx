"use client";
import { useState } from "react";

export function CodeEntry() {
  const [code, setCode] = useState("");
  function go(e: React.FormEvent) {
    e.preventDefault();
    const m = code.match(/\/t\/([^/?#\s]+)/);
    const c = (m ? m[1] : code).trim().toUpperCase().replace(/\s+/g, "-");
    if (c) window.location.href = `/t/${encodeURIComponent(c)}`;
  }
  return (
    <form onSubmit={go} className="stack">
      <p className="muted small" style={{ margin: 0 }}>Someone shared a PryingEyes link or code with you? Paste it here to message or call them.</p>
      <div className="field">
        <label htmlFor="code">Link or code</label>
        <input id="code" type="text" autoComplete="off" autoCapitalize="characters" placeholder="Paste a link, or a code like RW4TP-8NMKD" value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      <button className="btn block" disabled={!code.trim()}>Continue</button>
    </form>
  );
}
