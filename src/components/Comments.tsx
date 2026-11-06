"use client";
import { useEffect, useState } from "react";
import { api, errMsg, relTime } from "./api";
import { Icon } from "./Icon";

type C = { id: string; parentId: string | null; at: string; text: string; author: { id: string; handle: string }; mine: boolean };

export function Comments({ postId }: { postId: string }) {
  const [open, setOpen] = useState(false);
  const [cs, setCs] = useState<C[] | null>(null);
  const [text, setText] = useState(""); const [replyTo, setReplyTo] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const load = () => api(`/api/posts/${postId}/comments`).then((r) => setCs(r.comments)).catch((e) => setErr(errMsg(e)));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    try { await api(`/api/posts/${postId}/comments`, { body: { text, parentId: replyTo } }); setText(""); setReplyTo(null); await load(); }
    catch (x) { setErr(errMsg(x)); }
  }
  const top = (cs ?? []).filter((c) => !c.parentId);
  const replies = (id: string) => (cs ?? []).filter((c) => c.parentId === id);
  const count = cs?.length ?? 0;

  return (
    <div className="comments">
      <button type="button" className="linkbtn small" onClick={() => { const n = !open; setOpen(n); if (n) load(); }}>
        <Icon name="chat" size={14} /> {count ? `${count} comment${count === 1 ? "" : "s"}` : "Comment"}
      </button>
      {open && (
        <div className="stack" style={{ marginTop: 8 }}>
          {err && <div className="alert err">{err}</div>}
          {top.length === 0 && <p className="muted small">No comments yet.</p>}
          {top.map((c) => (
            <div key={c.id} className="comment">
              <div className="comment-row"><b>@{c.author.handle}</b><span className="muted tiny">{relTime(c.at)}</span></div>
              <p className="comment-text">{c.text}</p>
              <button type="button" className="linkbtn small" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>Reply</button>
              {replies(c.id).map((r) => (
                <div key={r.id} className="comment reply">
                  <div className="comment-row"><b>@{r.author.handle}</b><span className="muted tiny">{relTime(r.at)}</span></div>
                  <p className="comment-text">{r.text}</p>
                </div>
              ))}
              {replyTo === c.id && (
                <form onSubmit={submit} className="row" style={{ marginTop: 6 }}>
                  <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Reply to @${c.author.handle}…`} aria-label="Reply" style={{ flex: 1 }} />
                  <button className="btn sm" disabled={!text.trim()}>Reply</button>
                </form>
              )}
            </div>
          ))}
          {replyTo === null && (
            <form onSubmit={submit} className="row">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" aria-label="Comment" style={{ flex: 1 }} />
              <button className="btn sm" disabled={!text.trim()}>Post</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
