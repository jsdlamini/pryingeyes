"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Status = { kind: "idle" | "checking" | "ok" | "bad"; text: string };
const VALID = /^[a-z0-9][a-z0-9_.]{2,23}$/;
const OK_TEXT = "Available — keep it or make it your own.";

/** Keeps only what a handle may contain, as the person types. */
function clean(v: string) {
  return v.toLowerCase().replace(/^@+/, "").replace(/[\s-]+/g, "_").replace(/[^a-z0-9_.]/g, "").slice(0, 24);
}

/**
 * Handle input that arrives pre-filled with a free, randomly generated handle. People can keep
 * it, ask for another, or type their own (cleaned and checked live). Never derived from email or
 * phone: anything containing "@" (usually browser autofill) is rejected and the handle kept.
 * `onValidity` tells the form whether it may submit.
 */
export function HandleField({ value, onChange, onValidity, id = "handle" }:
  { value: string; onChange: (h: string) => void; onValidity?: (ok: boolean) => void; id?: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  const generated = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(value);

  useEffect(() => { onValidity?.(status.kind === "ok" || (status.kind === "idle" && !value)); }, [status, value, onValidity]);

  const suggest = useCallback(async () => {
    setStatus({ kind: "checking", text: "Finding a free handle…" });
    try {
      const r = await (await fetch("/api/auth/handle", { cache: "no-store" })).json();
      if (!r?.handle) throw new Error("no handle");
      generated.current = r.handle; last.current = r.handle;
      onChange(r.handle);
      setStatus({ kind: "ok", text: OK_TEXT });
    } catch {
      // Leave it empty: the server will generate one when the form is sent.
      onChange(""); last.current = "";
      setStatus({ kind: "idle", text: "We'll pick a handle for you when you continue." });
    }
  }, [onChange]);

  useEffect(() => { if (!value) suggest(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function edit(raw: string) {
    if (timer.current) clearTimeout(timer.current);
    if (raw.includes("@")) {
      // Almost always the browser filling in an email. Keep the previous handle.
      onChange(last.current);
      setStatus({ kind: "bad", text: "Handles can't contain @ — your email is never used as a handle." });
      setTimeout(() => setStatus(last.current && last.current === generated.current ? { kind: "ok", text: OK_TEXT } : { kind: "idle", text: "" }), 3500);
      return;
    }
    const h = clean(raw);
    last.current = h;
    onChange(h);
    if (!h) { setStatus({ kind: "idle", text: "Leave it empty and we'll pick one for you." }); return; }
    if (h === generated.current) { setStatus({ kind: "ok", text: OK_TEXT }); return; }
    if (!VALID.test(h)) {
      setStatus({ kind: "bad", text: h.length < 3 ? "At least 3 characters." : "Start with a letter or number." });
      return;
    }
    setStatus({ kind: "checking", text: "Checking…" });
    timer.current = setTimeout(async () => {
      try {
        const r = await (await fetch(`/api/auth/handle?check=${encodeURIComponent(h)}`, { cache: "no-store" })).json();
        setStatus(!r.valid ? { kind: "bad", text: r.message ?? "3–24 letters, numbers, _ or ." }
          : r.available ? { kind: "ok", text: "Available" } : { kind: "bad", text: "Taken — try another, or tap Suggest another." });
      } catch { setStatus({ kind: "ok", text: "" }); } // can't check right now; the server checks on submit
    }, 350);
  }

  return (
    <div className="field">
      <label htmlFor={id}>Handle</label>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input id={id} name="pe-public-handle" type="text" inputMode="text" maxLength={24}
          autoComplete="nickname" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          data-lpignore="true" data-1p-ignore="true" data-form-type="other"
          value={value} onChange={(e) => edit(e.target.value)}
          aria-describedby={`${id}-hint`} aria-invalid={status.kind === "bad"} />
        <button type="button" className="btn ghost sm" onClick={suggest} style={{ flexShrink: 0 }}>Suggest another</button>
      </div>
      <p id={`${id}-hint`} className="hint" aria-live="polite" style={{ color: status.kind === "bad" ? "var(--bad)" : status.kind === "ok" ? "var(--good)" : undefined }}>
        {status.text || "What people you contact will see. Letters, numbers, _ and . only."}
      </p>
    </div>
  );
}
