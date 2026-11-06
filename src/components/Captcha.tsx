"use client";
import { useEffect, useRef, useState } from "react";

declare global { interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void } } }

/**
 * Human check. Production: Cloudflare Turnstile (accessible, privacy-friendly).
 * Development: a plain checkbox standing in for it — the server only accepts it outside production.
 */
export function Captcha({ mode, siteKey, onToken }: { mode: "dev" | "turnstile"; siteKey?: string; onToken: (t: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (mode !== "turnstile" || !box.current) return;
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => window.turnstile?.render(box.current!, {
      sitekey: siteKey, callback: (t: string) => onToken(t), "expired-callback": () => onToken(null), "error-callback": () => onToken(null),
    });
    document.head.appendChild(s);
    return () => { s.remove(); };
  }, [mode, siteKey, onToken]);
  if (mode === "turnstile") return <div ref={box} aria-label="Human check" />;
  return (
    <label className="check" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", background: "var(--card)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => { setChecked(e.target.checked); onToken(e.target.checked ? "dev-human-check-passed" : null); }} />
      <span>I'm a person, not a bot <span className="muted tiny">(development check)</span></span>
    </label>
  );
}
