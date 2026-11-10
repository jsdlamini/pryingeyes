"use client";
import { useEffect, useState } from "react";

type Preview = { url: string; host: string; title: string | null; image: string | null; description: string | null };

export function LinkCard({ url }: { url: string }) {
  const [d, setD] = useState<Preview | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
      .then((r) => r.json()).then((j) => { if (alive) setD(j); }).catch(() => {});
    return () => { alive = false; };
  }, [url]);
  const host = d?.host ?? (() => { try { return new URL(url).host; } catch { return url; } })();
  return (
    <a className="link-card" href={url} target="_blank" rel="noreferrer">
      {d?.image ? <img src={d.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
      <span className="link-card-body">
        <span className="link-card-host">{host}</span>
        <b>{d?.title || url}</b>
        {d?.description ? <span className="muted small">{d.description}</span> : null}
      </span>
    </a>
  );
}
