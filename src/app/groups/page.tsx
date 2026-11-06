"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errMsg, relTime } from "@/components/api";
import { Icon } from "@/components/Icon";
import { Composer, PostCard, type PostView } from "@/components/Social";
import { Comments } from "@/components/Comments";

type G = { id: string; name: string; role: string; members: number; lastPostAt: string | null; requests: number };
type Found = { id: string; name: string; about: string; members: number; joined: boolean; requested: boolean };
type Person = { author: { id: string; handle: string }; you: boolean; following: boolean; items: PostView[] };
type TimelineItem = PostView & { author: { id: string; handle: string }; you: boolean; following: boolean };

export default function Groups() {
  const router = useRouter();
  const [groups, setGroups] = useState<G[] | null>(null);
  const [pending, setPending] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState(""); const [found, setFound] = useState<Found[] | null>(null);
  const [listed, setListed] = useState(true);
  const [people, setPeople] = useState<Person[]>([]);
  const [name, setName] = useState(""); const [invite, setInvite] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => Promise.all([api("/api/groups"), api("/api/status")])
    .then(([g, s]) => { setGroups(g.groups); setPending(g.pending); setPeople(s.people); }).catch((e) => setErr(errMsg(e))), []);
  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    try { const r = await api("/api/groups", { body: { name, listed } }); router.push(`/groups/${r.id}?created=1`); } catch (x) { setErr(errMsg(x)); }
  }
  async function search(e?: React.FormEvent) {
    e?.preventDefault(); setErr("");
    try { setFound((await api(`/api/groups/discover?q=${encodeURIComponent(q)}`)).groups); } catch (x) { setErr(errMsg(x)); }
  }
  async function ask(g: Found) {
    setErr("");
    try { await api(`/api/groups/${g.id}/join`, { body: {} }); await search(); await load(); } catch (x) { setErr(errMsg(x)); }
  }
  function join(e: React.FormEvent) {
    e.preventDefault();
    const m = invite.trim().match(/\/g\/([0-9A-Za-z-]+)/)?.[1] ?? invite.trim();
    if (m) router.push(`/g/${encodeURIComponent(m)}`);
  }
  async function followHandle(a: { id: string; handle: string }, following: boolean) {
    setErr("");
    try { await api("/api/social/follow", { body: { handle: a.handle, follow: !following } }); await load(); } catch (x) { setErr(errMsg(x)); }
  }

  const timeline: TimelineItem[] = people
    .flatMap((p) => p.items.map((it) => ({ ...it, author: p.author, you: p.you, following: p.following })))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div><h1 style={{ marginBottom: 2 }}>Feed</h1><p className="muted small" style={{ margin: 0 }}>What&apos;s on people&apos;s minds, and the groups you belong to.</p></div>
      </div>
      {err && <div className="alert err">{err}</div>}

      <div className="feed-layout">
        <aside className="feed-side">
          <section className="card" aria-labelledby="find-h">
            <h2 id="find-h" style={{ marginTop: 0 }}>Find a group</h2>
            <form onSubmit={search} className="row">
              <label htmlFor="gq" className="sr-only">Search groups</label>
              <input id="gq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or topic" style={{ flex: 1 }} data-testid="group-search" />
              <button className="iconbtn solid" aria-label="Search" title="Search"><Icon name="search" size={18} /></button>
            </form>
            {found && (found.length === 0 ? <p className="muted small">No groups match.</p> : (
              <ul className="members" style={{ marginTop: 10 }}>{found.map((g) => (
                <li key={g.id} data-testid="found-group"><span><b>{g.name}</b><br /><span className="muted tiny">{g.members} member{g.members === 1 ? "" : "s"}</span></span>
                  {g.joined ? <Link className="btn ghost sm" href={`/groups/${g.id}`}>Open</Link>
                    : g.requested ? <span className="muted small">Asked</span>
                    : <button className="btn sm" onClick={() => ask(g)} data-testid="ask-join">Join</button>}
                </li>))}</ul>
            ))}
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>Your groups</h2>
            {!groups ? <p>Loading…</p> : groups.length === 0 ? <p className="muted small">No groups yet.</p> : (
              <ul className="feed">{groups.map((g) => (
                <li key={g.id}><span className="t">{g.lastPostAt ? relTime(g.lastPostAt) : "new"}</span>
                  <span><Link href={`/groups/${g.id}`}><b>{g.name}</b></Link><br /><span className="muted tiny">{g.members} member{g.members === 1 ? "" : "s"}</span></span>
                  <span>{g.requests > 0 && <Link href={`/groups/${g.id}`} className="badge-count" aria-label={`${g.requests} asking to join`}>{g.requests}</Link>}</span></li>))}</ul>
            )}
            {pending.length > 0 && <p className="small muted" data-testid="pending">Waiting: {pending.map((p) => p.name).join(", ")}</p>}
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>Start a group</h2>
            <form onSubmit={create} className="stack">
              <div className="row"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Manzini Market" data-testid="group-name" />
                <button className="btn sm" disabled={name.trim().length < 2} data-testid="group-create"><Icon name="plus" size={16} />Create</button></div>
              <div className="chips" role="group" aria-label="Group visibility">
                <button type="button" className="chip" aria-pressed={listed} onClick={() => setListed(true)}>Public</button>
                <button type="button" className="chip" aria-pressed={!listed} onClick={() => setListed(false)}>Private</button>
              </div>
              <p className="muted tiny" style={{ margin: 0 }}>{listed ? "Anyone can find and ask to join (you approve)." : "Only people with the invite link can join."}</p>
            </form>
            <form onSubmit={join} className="stack" style={{ marginTop: 10 }}>
              <label className="small" htmlFor="ginv"><b>Join with an invite link</b></label>
              <div className="row"><input id="ginv" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="https://…/g/…" />
                <button className="btn ghost sm" disabled={invite.trim().length < 12}>Join</button></div>
            </form>
          </section>
        </aside>

        <main className="feed-main">
          <section className="card" aria-labelledby="share-h">
            <h2 id="share-h" className="sr-only">Share</h2>
            <Composer placeholder="What&apos;s on your mind? Share how you feel…"
              onPost={async (b) => { await api("/api/status", { body: b }); await load(); }} />
          </section>

          <section className="card" aria-labelledby="feed-h">
            <h2 id="feed-h" style={{ marginTop: 0 }}>Latest</h2>
            {timeline.length === 0 ? <p className="muted small">Nothing here yet. Share what&apos;s on your mind, or join a group.</p> : (
              <div className="stack">
                {timeline.map((p) => (
                  <div key={p.id} className="post-wrap">
                    <div className="spread" style={{ marginBottom: 4 }}><b>@{p.author.handle}</b>{!p.you && <button className={`btn sm${p.following ? " ghost" : ""}`} onClick={() => followHandle(p.author, p.following)}>{p.following ? "Following" : "Follow"}</button>}</div>
                    <PostCard p={p} onChanged={load} />
                    <Comments postId={p.id} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
