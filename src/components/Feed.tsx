"use client";
import { clock } from "./api";

export type FeedEntry = { seq: number; at: string; type: string; actor: string | null; token: string | null; text: string; region: string | null; reason: string | null; outcome: string; durationSec: number | null };

export function Feed({ events }: { events: FeedEntry[] }) {
  if (!events.length) return <p className="muted small">Nothing yet. Activity on your codes appears here as it happens.</p>;
  return (
    <ul className="feed">
      {events.map((e) => (
        <li key={e.seq}>
          <span className="t">{clock(e.at)}</span>
          <span>
            {e.actor ? <><b>@{e.actor}</b> {e.text}</> : e.text}
            {e.token && <> · <i>{e.token}</i></>}
            <br /><span className="muted tiny">{[e.region, e.reason && e.reason.replace(/_/g, " "), e.durationSec ? `${Math.round(e.durationSec / 60)} min` : null].filter(Boolean).join(" · ")}</span>
          </span>
          <span className={`status ${e.outcome === "bad" ? "bad" : e.outcome === "pending" ? "pending" : "good"}`}>{e.outcome === "bad" ? "Blocked" : e.outcome === "pending" ? "Pending" : "OK"}</span>
        </li>
      ))}
    </ul>
  );
}
