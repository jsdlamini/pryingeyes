import { botState, CONTENT_CATEGORIES, CONTENT_CATEGORY_LABEL } from "@/lib/content";

export const metadata = { title: "The PryingEyes bot" };

/** Public page explaining what the bot is and how far it has got. No source or queue details. */
export default async function Bot() {
  const s = await botState();
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1>The PryingEyes bot</h1>
      <p>
        A small, built-in helper that watches a handful of official public-notice pages and posts
        summaries into the matching notice boards: jobs, scholarships, scam alerts, tenders, service
        notices and weather warnings. Each post names its source and links to the original, so you
        can always check for yourself.
      </p>
      <div className="card">
        <h2>Status</h2>
        <p className="muted small" style={{ margin: 0 }}>
          {s.enabled ? (s.paused ? "Paused — no new notices are being fetched." : "Running.") : "Off."}
          {s.lastRunAt ? ` Last checked ${new Date(s.lastRunAt).toLocaleString()}.` : " It hasn't run yet."}
        </p>
      </div>
      <div className="card">
        <h2>What it covers</h2>
        <ul className="members" style={{ margin: 0 }}>
          {CONTENT_CATEGORIES.map((c) => <li key={c}><b>{CONTENT_CATEGORY_LABEL[c]}</b></li>)}
        </ul>
        <p className="muted tiny" style={{ margin: "10px 0 0" }}>
          Eswatini comes first; more countries are added through the bot's own settings, not new code.
          Posts are summaries in the bot's own words, always with a link to the source, and they
          expire at their deadline.
        </p>
      </div>
    </div>
  );
}
