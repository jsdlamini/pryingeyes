"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg, relTime } from "./api";
import { Icon } from "./Icon";
import { ReactionBar } from "./ReactionBar";
import { Avatar } from "./Avatar";
import { uploadAudio, uploadImage } from "./upload";
import { useVoiceRecorder } from "./useVoiceRecorder";

export type Comment = { id: string; parentId: string | null; at: string; text: string; attachment: string | null; reactions: { emoji: string; count: number; mine: boolean }[]; author: { id: string; handle: string; avatar: string | null }; mine: boolean };

/** The viewer's handle, remembered once so optimistic comments carry a real name. */
let myHandle = "";
async function whoAmI(): Promise<string> {
  if (myHandle) return myHandle;
  try { myHandle = (await api("/api/me")).user?.handle ?? "you"; } catch { myHandle = "you"; }
  return myHandle;
}

/**
 * Comments on one post, threaded to any depth. Replies nest under their parent
 * (reply to a reply stays in the right branch) and appear instantly: the list is
 * updated optimistically and re-synced from the server after the round trip.
 */
export function Comments({ postId, startOpen = false, initialCount = 0 }: { postId: string; startOpen?: boolean; initialCount?: number }) {
  const [open, setOpen] = useState(startOpen);
  const [cs, setCs] = useState<Comment[] | null>(null);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [img, setImg] = useState<string | null>(null); const [imgBusy, setImgBusy] = useState(false); const fileRef = useRef<HTMLInputElement>(null);
  const [voice, setVoice] = useState<string | null>(null);
  const vr = useVoiceRecorder();
  useEffect(() => {
    if (!vr.blob) return;
    setErr("");
    uploadAudio(vr.blob).then((url) => { setVoice(url); setImg(null); }).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't record that voice note."));
  }, [vr.blob]);
  async function startVoice() {
    setErr("");
    const ok = await vr.start();
    if (!ok) setErr("PryingEyes needs your microphone for voice notes.");
  }
  const load = useCallback(() =>
    api(`/api/posts/${postId}/comments`).then((r) => setCs(r.comments)).catch((e) => setErr(errMsg(e))), [postId]);
  useEffect(() => { if (open && cs === null) void load(); }, [open, cs, load]);

  /** Shared by the top-level form and every nested Reply button. */
  async function send(body: string, parent: Comment | null, attachment: string | null = null) {
    const trimmed = body.trim();
    if ((!trimmed && !attachment && !voice) || busy) return;
    setErr(""); setBusy(true);
    const temp: Comment = { id: `tmp-${Date.now()}`, parentId: parent?.id ?? null, at: new Date().toISOString(),
      text: trimmed, attachment: attachment ?? voice, reactions: [], author: { id: "me", handle: myHandle || "you", avatar: null }, mine: true };
    setCs((prev) => [...(prev ?? []), temp]);                    // instant
    setReplyTo(null);
    try {
      await api(`/api/posts/${postId}/comments`, { body: { text: trimmed, parentId: parent?.id ?? null, attachment: attachment ?? voice } });
      await load();                                              // true order + real data
    } catch (x) {
      setCs((prev) => (prev ?? []).filter((c) => c.id !== temp.id));  // roll back
      setErr(errMsg(x));
    } finally { setBusy(false); }
  }

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErr(""); setImgBusy(true);
    try { setImg(await uploadImage(f)); } catch { setErr("Couldn't attach that image."); }
    finally { setImgBusy(false); }
  }

  function toggle() {
    const n = !open;
    setOpen(n);
    if (n) void whoAmI().then(() => load());
  }

  const count = cs?.length ?? initialCount;
  const roots = (cs ?? []).filter((c) => !c.parentId);

  return (
    <div className="comments">
      <button type="button" className="linkbtn small" onClick={toggle} aria-expanded={open}>
        <Icon name="chat" size={14} /> {count ? `${count} comment${count === 1 ? "" : "s"}` : "Comment"}
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          {err && <div className="alert err" role="alert">{err}</div>}
          {cs === null ? <p className="muted small">Loading…</p>
            : cs.length === 0 ? <p className="muted small">No comments yet. Say something kind.</p> : null}
          {roots.map((c) => (
            <Node key={c.id} c={c} all={cs ?? []} replyTo={replyTo} setReplyTo={setReplyTo} onSend={send} busy={busy} />
          ))}
          {img ? <div className="attach-preview sm"><img src={img} alt="Attachment" /><button type="button" className="iconbtn sm" onClick={() => setImg(null)} aria-label="Remove image"><Icon name="x" size={14} /></button></div> : null}
          <form className="comment-form" onSubmit={(e) => { e.preventDefault(); void send(text, null, img).then(() => { setImg(null); setVoice(null); vr.reset(); }); }}>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
            <label className="sr-only" htmlFor={`c-${postId}`}>{replyTo ? `Reply to @${replyTo.author.handle}` : "Add a comment"}</label>
            <input id={`c-${postId}`} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Add a comment…" aria-label="Add a comment" maxLength={1000} />
            <button type="button" className={`iconbtn sm${vr.recording ? " recording" : ""}`} onClick={vr.recording ? vr.stop : startVoice} aria-label="Record voice note" title="Record voice note"><Icon name="mic" size={16} /></button>
            <button type="button" className="iconbtn sm" onClick={() => fileRef.current?.click()} disabled={imgBusy} aria-label="Add image" title="Add image"><Icon name="image" size={16} /></button>
            <button className="btn sm" disabled={busy || (!text.trim() && !img && !voice)}>Post</button>
          </form>
        </div>
      )}
    </div>
  );
}

/** One comment and its replies, nested recursively. */
function Node({ c, all, replyTo, setReplyTo, onSend, busy, parentAuthor }: {
  c: Comment; all: Comment[]; replyTo: Comment | null; setReplyTo: (c: Comment | null) => void;
  onSend: (text: string, parent: Comment) => Promise<void>; busy: boolean; parentAuthor?: string;
}) {
  const kids = all.filter((k) => k.parentId === c.id);
  const [draft, setDraft] = useState("");
  const replying = replyTo?.id === c.id;

  return (
    <div className="comment">
      <div className="comment-row">
        <Avatar handle={c.author.handle} src={c.author.avatar} className="sm" round />
        <span className={`comment-who${c.mine ? " me" : ""}`}>@{c.author.handle}</span>{c.mine ? <span className="you-tag">(you)</span> : null}
        {parentAuthor && <span className="replying-to"><Icon name="reply" size={11} /> replying to @{parentAuthor}</span>}
        <span className="muted tiny">{relTime(c.at)}</span>
      </div>
      <p className="comment-text">{c.text}</p>
      {c.attachment ? (/\.(m4a|mp3|ogg|webm)$/.test(c.attachment) ? <audio controls src={c.attachment} className="comment-attach voice" preload="metadata" /> : /\.(mp4|mov|m4v)$/.test(c.attachment) ? <video controls src={c.attachment} className="comment-attach video" preload="metadata" /> : <img className="comment-attach" src={c.attachment} alt="" loading="lazy" />) : null}
      <ReactionBar kind="comment" targetId={c.id} initial={c.reactions} />
      <button type="button" className="linkbtn tiny" onClick={() => { setReplyTo(replying ? null : c); setDraft(""); }} aria-pressed={replying}>
        <Icon name="reply" size={13} /> Reply
      </button>
      {replying && (
        <form className="comment-form" onSubmit={(e) => { e.preventDefault(); void onSend(draft, c).then(() => setDraft("")); }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Reply to @${c.author.handle}…`}
            aria-label={`Reply to @${c.author.handle}`} maxLength={1000} autoFocus />
          <button className="btn sm" disabled={busy || !draft.trim()}>Reply</button>
        </form>
      )}
      {kids.length > 0 && (
        <div className="comment replies">
          {kids.map((k) => (
            <Node key={k.id} c={k} all={all} replyTo={replyTo} setReplyTo={setReplyTo} onSend={onSend} busy={busy} parentAuthor={c.author.handle} />
          ))}
        </div>
      )}
    </div>
  );
}
