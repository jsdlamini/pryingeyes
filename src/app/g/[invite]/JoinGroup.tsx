"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errMsg } from "@/components/api";

type Preview = { id: string; name: string; about: string; members: number; joined: boolean; requested: boolean };

export function JoinGroup({ invite }: { invite: string }) {
  const router = useRouter();
  const [g, setG] = useState<Preview | null>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => { api("/api/groups/join", { body: { invite, preview: true } }).then((r) => setG(r.group)).catch((e) => setErr(errMsg(e))); }, [invite]);
  if (err) return <div className="card"><h1>Invite not valid</h1><p className="muted">{err}</p></div>;
  if (!g) return <div className="card"><p>Loading…</p></div>;
  return (
    <div className="card stack">
      <p className="muted small" style={{ margin: 0 }}>You&apos;re invited to</p>
      <h1 style={{ margin: 0 }} data-testid="join-name">{g.name}</h1>
      {g.about ? <p>{g.about}</p> : null}
      <p className="small muted">{g.members} member{g.members === 1 ? "" : "s"}. Members see each other by handle. Contact details are shared only as contact codes, never as numbers.</p>
      {g.joined ? <button className="btn block" onClick={() => router.push(`/groups/${g.id}`)}>Open group</button>
        : g.requested ? <div className="alert ok" role="status" data-testid="join-requested">You&apos;ve asked to join. An admin will let you in, and you&apos;ll get a notification.</div>
        : <>
          <div className="field" style={{ marginBottom: 0 }}><label htmlFor="jn">A note for the admins (optional)</label>
            <input id="jn" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who you are, so they know to let you in" /></div>
          <button className="btn block" disabled={busy} data-testid="join-confirm" onClick={async () => {
            setBusy(true);
            try { await api("/api/groups/join", { body: { invite, note } }); setG({ ...g, requested: true }); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
          }}>Ask to join</button>
        </>}
    </div>
  );
}
