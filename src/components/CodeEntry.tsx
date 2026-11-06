"use client";
import { useState } from "react";

export function CodeEntry() {
  const [code, setCode] = useState("");
  function go(e: React.FormEvent) {
    e.preventDefault();
    const m = code.match(/\/t\/([^/?#\s]+)/);
    const c = (m ? m[1] : code).trim().replace(/\s+/g, "-");
    if (c) window.location.href = `/t/${encodeURIComponent(c)}`;
  }
  return (
    <form onSubmit={go}>
      <label htmlFor="code">Link or code</label>
      <input id="code" type="text" autoComplete="off" autoCapitalize="characters" placeholder="e.g. RW4TP-8NMKD" value={code} onChange={(e) => setCode(e.target.value)} />
      <button className="btn block" style={{ marginTop: 10 }} disabled={!code.trim()}>Continue</button>
    </form>
  );
}
