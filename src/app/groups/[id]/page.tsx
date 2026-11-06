"use client";
import { use, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errMsg } from "@/components/api";
import { Icon } from "@/components/Icon";
import { Composer, PostCard, type PostView } from "@/components/Social";

type Detail = { id: string; name: string; about: string; role: "admin" | "member"; invite: string | null; listed: boolean;
  members: { id: string; handle: string; role: string; you: boolean }[];
  requests: { userId: string; handle: string; note: string; via: string; at: string }[] };

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const created = useSearchParams().get("created");
  const [g, setG] = useState<Detail | null>(null);
  const [posts, setPosts] = useState<PostView[] | null>(null);
  const [err, setErr] = useState(""); const [copied, setCopied] = useState(false);
  const load = useCallback(() => Promise.all([api(`/api/groups/${id}`), api(`/api/groups/${id}/posts`)])
    .then(([d, p]) => { setG(d.group); setPosts(p.posts); }).catch((e) => setErr(errMsg(e))), [id]);
  useEffect(() => { void load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);
  const act = (fn: () => Promise<unknown>) => fn().then(load).catch((e) => setErr(errMsg(e)));

  return (
    <div className="page group-layout">
      <div>
        <h1>{g?.name ?? "Group"}</h1>
        {g?.about ? <p className="muted">{g.about}</p> : null}
        {err && <div className="alert err">{err}</div>}
        {created && g?.invite ? <div className="alert ok">Group created. Share the invite link with the people you want in it.</div> : null}
        <Composer placeholder="Share with the group" onPost={async (b) => { await api(`/api/groups/${id}/posts`, { body: b }); await load(); }} />
        <div className="stack" style={{ marginTop: 14 }}>
          {posts && posts.length === 0 ? <p className="muted small">No posts yet. Selling something or offering a service? Attach your contact code so people can reach you without your number.</p> : null}
          {posts?.map((p) => <PostCard key={p.id} p={p} onChanged={load} />)}
        </div>
      </div>
      <aside>
        {g?.role === "admin" && (
          <div className="card" data-testid="join-requests">
            <h2 style={{ marginTop: 0 }}>Asking to join{g.requests.length ? ` (${g.requests.length})` : ""}</h2>
            {g.requests.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No one is waiting. You and the other admins decide who gets in.</p>
              : g.requests.map((r) => (
                <div key={r.userId} className="request-row" data-testid="join-request">
                  <span><b>@{r.handle}</b>{r.note ? <><br /><span className="small muted">&ldquo;{r.note}&rdquo;</span></> : null}<br /><span className="tiny muted">{r.via === "invite" ? "Used the invite link" : "Found it in search"}</span></span>
                  <span className="row">
                    <button className="btn sm" onClick={() => act(() => api(`/api/groups/${id}/requests`, { body: { userId: r.userId, decision: "approve" } }))} data-testid="approve-join"><Icon name="userCheck" size={16} />Let in</button>
                    <button className="btn ghost sm" onClick={() => act(() => api(`/api/groups/${id}/requests`, { body: { userId: r.userId, decision: "decline" } }))}><Icon name="x" size={16} />Decline</button>
                  </span>
                </div>))}
            <label className="check small" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={g.listed} onChange={(e) => act(() => api(`/api/groups/${id}`, { method: "PATCH", body: { listed: e.target.checked } }))} />
              <span>Show this group in search</span>
            </label>
          </div>
        )}
        {g?.invite ? (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Invite link</h2>
            <p className="small muted">Anyone with this link can ask to join; you approve them. On a phone with PryingEyes installed it opens the app.</p>
            <code className="invite" data-testid="invite-link">{g.invite}</code>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={async () => { await navigator.clipboard?.writeText(g.invite!); setCopied(true); setTimeout(() => setCopied(false), 1500); }}><Icon name={copied ? "check" : "copy"} size={16} />{copied ? "Copied" : "Copy link"}</button>
              <button className="btn ghost sm" onClick={() => { if (confirm("Make a new link? The old one stops working.")) act(() => api(`/api/groups/${id}/invite`, { body: {} })); }}><Icon name="refresh" size={16} />New link</button>
            </div>
          </div>
        ) : null}
        {g ? (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>{g.members.length} member{g.members.length === 1 ? "" : "s"}</h2>
            <ul className="members">{g.members.map((m) => (
              <li key={m.id}><span>@{m.handle}{m.you ? " (you)" : ""}{m.role === "admin" ? <span className="muted tiny"> · admin</span> : null}</span>
                {g.role === "admin" && !m.you ? <span className="row">
                  {m.role !== "admin" ? <button className="iconbtn sm plain" onClick={() => act(() => api(`/api/groups/${id}/members`, { body: { userId: m.id, action: "make_admin" } }))} aria-label={`Make @${m.handle} an admin`} title="Make admin"><Icon name="shield" size={16} /></button> : null}
                  <button className="iconbtn sm plain danger" onClick={() => { if (confirm(`Remove @${m.handle}?`)) act(() => api(`/api/groups/${id}/members`, { body: { userId: m.id, action: "remove" } })); }} aria-label={`Remove @${m.handle}`} title="Remove"><Icon name="trash" size={16} /></button>
                </span> : null}
              </li>))}</ul>
            <button className="btn danger-ghost sm" style={{ marginTop: 10 }} onClick={() => { if (confirm("Leave this group?")) api(`/api/groups/${id}/leave`, { body: {} }).then(() => router.push("/groups")).catch((e) => setErr(errMsg(e))); }}><Icon name="logout" size={16} />Leave group</button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
