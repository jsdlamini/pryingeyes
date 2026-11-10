"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, errMsg, relTime } from "@/components/api";
import { Icon } from "@/components/Icon";

type Person = { id: string; handle: string; following: boolean; sharesGroups: number; followers: number; liveStatus: boolean; latestAt: string | null };

/** Follow state is kept locally so the button flips the instant you tap it. */
export default function PeoplePage() {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (query: string) => {
    try { const r = await api(`/api/social/people?q=${encodeURIComponent(query)}`); setPeople(r.people); setErr(""); }
    catch (e) { setErr(errMsg(e)); }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  // Debounced search-as-you-type.
  function onSearch(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(v.trim().replace(/^@+/, "")), 220);
  }

  async function follow(p: Person) {
    const next = !isFollowing(p);
    setOverride((o) => ({ ...o, [p.handle]: next }));           // instant
    try { await api("/api/social/follow", { body: { handle: p.handle, follow: next } }); }
    catch (e) { setOverride((o) => ({ ...o, [p.handle]: !next })); setErr(errMsg(e)); }
  }
  const isFollowing = (p: Person) => override[p.handle] ?? p.following;

  const searching = q.trim().length > 0;
  const results = people ?? [];

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <p className="eyebrow"><Icon name="compass" size={12} /> Discover</p>
        <h1>People</h1>
        <p className="muted small" style={{ margin: 0 }}>
          Everyone here shares a group with you or has a live status. Follow someone and their updates stay at the top of your feed.
        </p>
      </div>
      {err && <div className="alert err">{err}</div>}

      <div className="card card-tight" style={{ marginBottom: 10 }}>
        <form role="search" onSubmit={(e) => { e.preventDefault(); void load(q.trim().replace(/^@+/, "")); }}>
          <label htmlFor="pq" className="sr-only">Search people by handle</label>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <span className="iconbtn plain" aria-hidden style={{ pointerEvents: "none" }}><Icon name="search" size={17} /></span>
            <input id="pq" value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search by @handle…" autoFocus autoComplete="off" />
          </div>
        </form>
      </div>

      <div className="card">
        <div className="spread" style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>{searching ? "Search results" : "Suggested for you"}</h2>
          {!searching && <Link className="small" href="/groups">Browse groups</Link>}
        </div>
        {people === null ? <p className="muted small">Loading…</p>
          : results.length === 0 ? (
            <p className="muted small">{searching
              ? "No one matches that handle yet."
              : "No one to suggest yet. Join a group or post a status — the people you meet show up here."}</p>
          ) : results.map((p) => (
            <div key={p.id} className="person-row" data-testid="person-row">
              <span className="avatar" aria-hidden>{p.handle[0].toUpperCase()}</span>
              <span className="who">
                <b>@{p.handle}</b>
                <span>
                  {p.sharesGroups > 0 && `${p.sharesGroups} shared group${p.sharesGroups === 1 ? "" : "s"}`}
                  {p.followers > 0 && `${p.sharesGroups > 0 ? " · " : ""}${p.followers} follower${p.followers === 1 ? "" : "s"}`}
                  {p.liveStatus && <span style={{ color: "var(--good)" }}> · live now</span>}
                  {!p.liveStatus && p.latestAt && ` · posted ${relTime(p.latestAt)}`}
                </span>
              </span>
              <button type="button" className={`followbtn${isFollowing(p) ? " on" : ""}`} onClick={() => follow(p)} data-testid="follow-person">
                {isFollowing(p) ? <><Icon name="check" size={13} />Following</> : <><Icon name="userPlus" size={13} />Follow</>}
              </button>
            </div>
          ))}
      </div>

      {!searching && people && people.length > 0 && (
        <p className="small muted" style={{ marginTop: 10 }}>
          Looking for a specific conversation? Your <Link href="/chats">chats</Link> and <Link href="/groups">groups</Link> are one tap away.
        </p>
      )}
    </div>
  );
}
