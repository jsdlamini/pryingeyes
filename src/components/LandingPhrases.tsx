"use client";
import { useEffect, useState, type ReactNode } from "react";

const PHRASES: ReactNode[] = [
  <>Share a code, <span className="grad">not your number.</span></>,
  <>Reach people <span className="grad">without sharing digits.</span></>,
  <>You decide <span className="grad">who gets through.</span></>,
  <>Encrypted <span className="grad">by default.</span></>,
];

export function LandingPhrases() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % PHRASES.length), 5200);
    return () => clearInterval(id);
  }, []);
  return (
    <h1 className="landing-title phrase-rotator" aria-live="polite">
      {PHRASES.map((p, idx) => (
        <span key={idx} className={`phrase${idx === i ? " show" : ""}`} aria-hidden={idx !== i}>
          {p}
        </span>
      ))}
    </h1>
  );
}
