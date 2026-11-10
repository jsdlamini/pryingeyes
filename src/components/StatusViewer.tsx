"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

type Person = { author: { id: string; handle: string }; items: { id: string; text: string; attachment: string | null; at: string }[] };
const MS = 5000;

/** Full-screen story/status viewer with auto-advance, pause, and prev/next controls. */
export function StatusViewer({ people, startHandle, onClose }: { people: Person[]; startHandle: string; onClose: () => void }) {
  const [pi, setPi] = useState(() => Math.max(0, people.findIndex((p) => p.author.handle === startHandle)));
  const [si, setSi] = useState(0);
  const [pct, setPct] = useState(0);
  const [paused, setPaused] = useState(false);
  const startRef = useRef(Date.now());
  const accRef = useRef(0);

  const person = people[pi];
  const items = person?.items ?? [];
  const item = items[si];

  function next() {
    if (si < items.length - 1) setSi(si + 1);
    else if (pi < people.length - 1) { setPi(pi + 1); setSi(0); }
    else onClose();
  }
  function prev() {
    if (si > 0) setSi(si - 1);
    else if (pi > 0) { setPi(pi - 1); setSi(people[pi - 1].items.length - 1); }
  }
  function togglePause() {
    if (paused) { startRef.current = Date.now(); setPaused(false); }
    else { accRef.current += Date.now() - startRef.current; setPaused(true); }
  }

  useEffect(() => { accRef.current = 0; startRef.current = Date.now(); setPct(0); }, [pi, si]);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      const elapsed = accRef.current + (Date.now() - startRef.current);
      const p = Math.min(100, (elapsed / MS) * 100);
      setPct(p);
      if (p >= 100) next();
    }, 80);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pi, si, paused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
      if (e.key === " ") { e.preventDefault(); togglePause(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pi, si, paused, people.length]);

  if (!person || !item) return null;
  return (
    <div className="status-overlay" role="dialog" aria-modal="true" aria-label={`@${person.author.handle}'s status`}>
      <div className="status-bar">
        {items.map((_, i) => (
          <span key={i} className="status-seg">
            <span className={`status-fill${i < si ? " done" : ""}`} style={i === si ? { width: `${pct}%` } : i < si ? { width: "100%" } : undefined} />
          </span>
        ))}
      </div>
      <div className="status-head">
        <span className="avatar round sm">{person.author.handle[0].toUpperCase()}</span>
        <b>@{person.author.handle}</b>
        <span className="muted tiny">{new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        <button type="button" className="iconbtn" onClick={togglePause} aria-label={paused ? "Play" : "Pause"} title={paused ? "Play" : "Pause"}>{paused ? <Icon name="play" size={18} /> : <Icon name="pause" size={18} />}</button>
        <button type="button" className="iconbtn" onClick={onClose} aria-label="Close" title="Close"><Icon name="x" size={18} /></button>
      </div>
      <div className="status-body">
        {item.attachment ? <img src={item.attachment} alt="" /> : <p className="status-text">{item.text}</p>}
      </div>
      <button type="button" className="status-nav prev" onClick={prev} aria-label="Previous" title="Previous"><Icon name="chevron" size={22} /></button>
      <button type="button" className="status-nav next" onClick={next} aria-label="Next" title="Next"><Icon name="chevron" size={22} /></button>
      {paused && <div className="status-paused">Paused</div>}
    </div>
  );
}
