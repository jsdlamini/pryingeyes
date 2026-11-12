"use client";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { flagEmoji } from "@/lib/countries";

const CATS: Record<string, { label: string; emoji: string; color: string }> = {
  job: { label: "Jobs", emoji: "💼", color: "#1a7f4b" },
  scholarship: { label: "Scholarships", emoji: "🎓", color: "#2f6fdb" },
  scam_alert: { label: "Scam alert", emoji: "⚠️", color: "#c0392b" },
  tender: { label: "Tenders", emoji: "📑", color: "#b7791f" },
  service_notice: { label: "Service", emoji: "🔔", color: "#5b6b7b" },
  weather: { label: "Weather", emoji: "🌦️", color: "#0e7490" },
};

type Notice = { id: string; text: string; category: string; country: string; region: string | null; deadline: string | null; source: string };

function daysLeft(d: string | null): string | null {
  if (!d) return null;
  const t = new Date(d).getTime() - Date.now();
  if (t <= 0) return "expired";
  const days = Math.floor(t / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

/** A scrolling board of the bot's latest public notices. Shown on the dashboard only when there is something. */
export function Notices() {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  useEffect(() => { api("/api/notices").then((r) => setNotices(r.notices)).catch(() => undefined); }, []);
  if (!notices || notices.length === 0) return null;
  return (
    <section className="card card-tight notices" aria-label="Public notices">
      <h2 style={{ margin: 0 }}>📌 Public notices</h2>
      <div className="notices-strip">
        {notices.map((n) => {
          const c = CATS[n.category] ?? CATS.service_notice;
          const dl = daysLeft(n.deadline);
          return (
            <article key={n.id} className="notice-card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span className="notice-cat" style={{ color: c.color, borderColor: c.color }}>{c.emoji} {c.label}</span>
                <span className="notice-flag">{flagEmoji(n.country)} {n.country}{n.region ? ` · ${n.region}` : ""}</span>
              </div>
              <p className="notice-text">{n.text}</p>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span className="notice-deadline">{dl ? `⏳ ${dl}` : ""}</span>
                {n.source ? <a className="notice-source" href={n.source} target="_blank" rel="noreferrer noopener">Source ↗</a> : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
