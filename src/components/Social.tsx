"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, errMsg, relTime } from "./api";
import { Icon } from "./Icon";
import { LinkCard } from "./LinkCard";
import { Tier, TIER_LINES, TIER_NAMES } from "./Tier";
import { Comments } from "./Comments";
import { uploadAudio, uploadImage, uploadVideo } from "./upload";
import { useVoiceRecorder } from "./useVoiceRecorder";
import { ReactionBar } from "./ReactionBar";
import { Avatar } from "./Avatar";

export type CodeKind = "standard" | "day" | "one";
export type CodeView = { short: string; link: string; tier: number; live: boolean; state?: "live" | "used" | "expired" | "off"; kind?: CodeKind };
const KIND_LABEL: Record<CodeKind, string> = { standard: "", day: "24 hours", one: "One person" };
const OFF_TEXT = { used: "This one-person code has already been used.", expired: "This contact code has expired.", off: "This contact code has been switched off." };
export type PostView = {
  id: string; at: string; expiresAt: string | null; text: string; mine: boolean; canDelete: boolean;
  commentCount: number;
  attachment: string | null;
  reactions: { emoji: string; count: number; mine: boolean }[];
  author: { id: string; handle: string; avatar: string | null }; code: CodeView | null;
};

const CODE_IN_TEXT = /(https?:\/\/[^\s]+\/t\/[0-9A-Za-z-]{16,24}|\b[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}\b)/g;
const codePath = (s: string) => `/t/${encodeURIComponent(s.match(/\/t\/([0-9A-Za-z-]+)/)?.[1] ?? s.replace("-", ""))}`;

/** Post text with PryingEyes codes and code links made into links to the gate. */
export function PostText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>]+|\b[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}\b)/g);
  const bare = (text.match(/https?:\/\/[^\s<>]+/gi) ?? []).find((u) => !/\/t\/[0-9A-Za-z-]{16,24}/.test(u));
  return (
    <div>
      <p className="post-text">
        {parts.map((p, i) => {
          if (/^https?:\/\//i.test(p)) {
            return /\/t\/[0-9A-Za-z-]{16,24}/.test(p)
              ? <a key={i} href={codePath(p)} rel="noreferrer">{p}</a>
              : <a key={i} href={p} target="_blank" rel="noreferrer noopener">{p}</a>;
          }
          if (/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(p)) return <a key={i} href={codePath(p)} rel="noreferrer">{p}</a>;
          return p;
        })}
      </p>
      {bare ? <LinkCard url={bare} /> : null}
    </div>
  );
}

/** Chat message text: any code or code link becomes a tappable "contact code" chip that opens the gate. */
export function MessageText({ text, mine }: { text: string; mine: boolean }) {
  const parts = text.split(/(https?:\/\/[^\s<>]+|\b[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}\b)/g);
  return <>{parts.map((p, i) => {
    if (/^https?:\/\//i.test(p)) {
      return /\/t\/[0-9A-Za-z-]{16,24}/.test(p)
        ? (mine ? <span key={i} className="code-chip mine"><Icon name="mark" size={14} /> Your contact code</span>
          : <a key={i} className="code-chip" href={codePath(p)} data-testid="chat-code"><Icon name="mark" size={14} /> Open contact code</a>)
        : <a key={i} href={p} target="_blank" rel="noreferrer noopener">{p}</a>;
    }
    if (/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(p)) {
      return mine ? <span key={i} className="code-chip mine"><Icon name="mark" size={14} /> Your contact code</span>
        : <a key={i} className="code-chip" href={codePath(p)} data-testid="chat-code"><Icon name="mark" size={14} /> Open contact code</a>;
    }
    return p.trim() ? <span key={i} style={{ whiteSpace: "pre-wrap" }}>{p}</span> : null;
  })}</>;
}

/** How long a shared code works. */
export function KindPicker({ kind, setKind }: { kind: CodeKind; setKind: (k: CodeKind) => void }) {
  return (
    <div className="chips" role="group" aria-label="How long the code works">
      {([["standard", "Until I switch it off"], ["day", "24 hours"], ["one", "One person"]] as const).map(([k, l]) =>
        <button type="button" key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
    </div>
  );
}

/** The contact code on a post. Opening it takes you to the gate with the code filled in. */
export function CodeCard({ code, handle, mine }: { code: CodeView; handle: string; mine: boolean }) {
  if (!code.live) return <div className="code-card off"><Icon name="shield" size={18} /> <span className="small muted">{OFF_TEXT[code.state === "used" || code.state === "expired" ? code.state : "off"]}</span></div>;
  const inner = <>
    <span className="code-card-mark"><Icon name="mark" size={20} /></span>
    <span className="code-card-body"><b>{mine ? "Your contact code" : `Reach @${handle}`}</b><span className="code-card-code">{code.short}{code.kind && code.kind !== "standard" ? ` · ${KIND_LABEL[code.kind]}` : ""}</span></span>
    <Tier n={code.tier} />
  </>;
  return mine ? <div className="code-card">{inner}</div> : <a className="code-card" href={codePath(code.link)} data-testid="code-card">{inner}</a>;
}

const REASONS = ["scam", "harassment", "spam", "threats", "impersonation", "other"];

/**
 * A post (status or group post): author, text, optional contact code, follow,
 * comments threaded underneath. Delete asks once inline — no browser dialogs.
 */
export function PostCard({ p, onChanged, following, onFollow }: {
  p: PostView; onChanged: () => void;
  following?: boolean; onFollow?: (handle: string, following: boolean) => void;
}) {
  const [reporting, setReporting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [editing, setEditing] = useState(false); const [editText, setEditText] = useState(p.text);
  const [handleOpen, setHandleOpen] = useState(false);
  const [err, setErr] = useState("");

  function del() {
    if (!confirmDel) { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 3000); return; }   // click once to arm, again to delete
    setConfirmDel(false);
    api(`/api/posts/${p.id}`, { method: "DELETE" }).then(onChanged).catch((e) => setErr(errMsg(e)));
  }
  const report = (reason: string) => api(`/api/posts/${p.id}/report`, { body: { reason, block: true } })
    .then(() => { setReporting(false); onChanged(); }).catch((e) => setErr(errMsg(e)));
  async function saveEdit() {
    setErr("");
    try { await api(`/api/posts/${p.id}`, { method: "PATCH", body: { text: editText } }); setEditing(false); onChanged(); }
    catch (x) { setErr(errMsg(x)); }
  }

  return (
    <article className="post" data-testid="post">
      <div className="post-head">
        <Avatar handle={p.author.handle} src={p.author.avatar} />
        <span className="who">
          <span className="handle-line">
            {p.mine ? <><b className="me">@{p.author.handle}</b><span className="you-tag">(you)</span></> : (
              <span className="handle-wrap">
                <button type="button" className="handle-btn" onClick={() => setHandleOpen((x) => !x)} aria-expanded={handleOpen} aria-haspopup="true">
                  @{p.author.handle} <Icon name="chevron" size={13} />
                </button>
                {handleOpen && (
                  <div className="handle-pop" role="menu">
                    {p.code?.live ? (
                      <>
                        <a href={p.code.link} onClick={() => setHandleOpen(false)}><Icon name="chat" size={15} />Message @{p.author.handle}</a>
                        <a href={p.code.link} onClick={() => setHandleOpen(false)}><Icon name="call" size={15} />Call @{p.author.handle}</a>
                      </>
                    ) : (
                      <span className="muted small">No contact code shared</span>
                    )}
                  </div>
                )}
              </span>
            )}
            {!p.mine && p.code?.live ? (
              <>
                <a className="handle-cta call" href={p.code.link} title={`Call @${p.author.handle}`} aria-label={`Call @${p.author.handle}`}><Icon name="call" size={15} /></a>
                <a className="handle-cta chat" href={p.code.link} title={`Message @${p.author.handle}`} aria-label={`Message @${p.author.handle}`}><Icon name="chat" size={15} /></a>
              </>
            ) : null}
          </span>
          <span className="when">{relTime(p.at)}</span>
        </span>
        <span className="grow" />
        {!p.mine && onFollow ? (
          <button type="button" className={`followbtn${following ? " on" : ""}`} onClick={() => onFollow(p.author.handle, !!following)}>
            {following ? <><Icon name="check" size={13} />Following</> : <><Icon name="userPlus" size={13} />Follow</>}
          </button>
        ) : null}
        {p.mine && !editing && (
          <button className="iconbtn sm plain" onClick={() => { setEditing(true); setEditText(p.text); }} aria-label="Edit post" title="Edit post"><Icon name="pencil" size={16} /></button>
        )}
        {p.canDelete && (
          <button className="iconbtn sm plain danger" onClick={del} aria-label={confirmDel ? "Confirm delete" : "Delete post"}
            title={confirmDel ? "Tap again to delete" : "Delete post"}>{confirmDel ? <Icon name="check" size={16} /> : <Icon name="trash" size={16} />}</button>
        )}
        {!p.mine && (
          <button className="iconbtn sm plain" onClick={() => setReporting((x) => !x)} aria-label="Report" title="Report" aria-pressed={reporting}><Icon name="flag" size={16} /></button>
        )}
      </div>
      {editing ? (
        <form className="stack" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}>
          <textarea value={editText} onChange={(e) => setEditText(e.target.value)} maxLength={1000} rows={3} autoFocus aria-label="Edit post" />
          <div className="row">
            <button type="submit" className="btn sm" disabled={!editText.trim()}>Save</button>
            <button type="button" className="btn sm ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          {p.text ? <PostText text={p.text} /> : null}
          {p.attachment ? (/\.(m4a|mp3|ogg|webm)$/.test(p.attachment) ? <audio controls src={p.attachment} className="post-attach voice" preload="metadata" /> : /\.(mp4|mov|m4v)$/.test(p.attachment) ? <video controls src={p.attachment} className="post-attach video" preload="metadata" /> : <img className="post-attach" src={p.attachment} alt="" loading="lazy" />) : null}
        </>
      )}
      {reporting ? <div className="stack" style={{ marginTop: 8 }}>
        <p className="small muted">The post goes to a moderator and the group admins, and you won&apos;t see posts from @{p.author.handle} any more.</p>
        <div className="chips">{REASONS.map((r) => <button key={r} className="chip" onClick={() => report(r)}>{r[0].toUpperCase() + r.slice(1)}</button>)}</div>
      </div> : null}
      {err ? <div className="alert err" style={{ marginTop: 8 }}>{err}</div> : null}
      <div className="post-actions">
        <ReactionBar kind="post" targetId={p.id} initial={p.reactions} />
        <Comments postId={p.id} initialCount={p.commentCount} />
      </div>
    </article>
  );
}

const TIER_HELP = TIER_LINES;

/** Post box with "Attach my contact code". Phone numbers in the text are refused with an explanation. */
export function Composer({ placeholder, onPost, buttonLabel = "Post" }: { placeholder: string; onPost: (b: { text: string; attach: { tier: number; kind: CodeKind } | null; attachment: string | null }) => Promise<unknown>; buttonLabel?: string }) {
  const [text, setText] = useState(""); const [attach, setAttach] = useState(true); const [tier, setTier] = useState(1); const [kind, setKind] = useState<CodeKind>("standard");
  const [showOpts, setShowOpts] = useState(false);
  const [codeWarned, setCodeWarned] = useState(() => { try { return localStorage.getItem("pe-code-warned") === "1"; } catch { return false; } });
  const [warnShow, setWarnShow] = useState(false);
  useEffect(() => {
    if (codeWarned) return;
    setWarnShow(true);
    const id = setTimeout(() => { setWarnShow(false); setCodeWarned(true); try { localStorage.setItem("pe-code-warned", "1"); } catch { /* ignore */ } }, 5000);
    return () => clearTimeout(id);
  }, [codeWarned]);
  const [err, setErr] = useState(""); const [blocked, setBlocked] = useState(false); const [busy, setBusy] = useState(false);
  const [img, setImg] = useState<string | null>(null); const [imgBusy, setImgBusy] = useState(false); const fileRef = useRef<HTMLInputElement>(null);
  const [voice, setVoice] = useState<string | null>(null);
  const vr = useVoiceRecorder();
  useEffect(() => {
    let alive = true;
    api("/api/me").then((r) => { if (alive && typeof r.user?.shareCodeByDefault === "boolean") setAttach(r.user.shareCodeByDefault); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!vr.blob) return;
    setErr("");
    uploadAudio(vr.blob).then((url) => { setVoice(url); setImg(null); }).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't record that voice note."));
  }, [vr.blob]);
  async function startVoice() {
    setErr("");
    const ok = await vr.start();
    if (!ok) setErr("PryingEyes needs your microphone for voice notes. Allow it in your browser settings, then try again.");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(""); setBlocked(false);
    try { await onPost({ text, attach: attach ? { tier, kind } : null, attachment: voice ?? img }); setText(""); setKind("standard"); setImg(null); setVoice(null); vr.reset(); try { localStorage.setItem("pe-code-warned", "1"); } catch { /* ignore */ } }
    catch (x) { setErr(errMsg(x)); if (x instanceof ApiError && x.code === "contact_info_detected") { setBlocked(true); setAttach(true); } }
    finally { setBusy(false); }
  }
  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErr(""); setImgBusy(true);
    try { setImg(f.type.startsWith("video/") ? await uploadVideo(f) : await uploadImage(f)); setVoice(null); } catch { setErr("Couldn't attach that file."); }
    finally { setImgBusy(false); }
  }
  return (
    <form className="card composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="composer">{placeholder}</label>
      <textarea id="composer" placeholder={placeholder} value={text} maxLength={1000} rows={3} onChange={(e) => { setText(e.target.value); setBlocked(false); }} data-testid="composer-input" />
      {img ? <div className="attach-preview">{/\.(mp4|mov|m4v)$/.test(img) ? <video src={img} controls className="composer-media" /> : <img src={img} alt="Attachment" />}<button type="button" className="iconbtn sm" onClick={() => setImg(null)} aria-label="Remove media"><Icon name="x" size={14} /></button></div> : null}
      {voice ? <div className="attach-preview"><audio controls src={voice} className="composer-voice" /><button type="button" className="iconbtn sm" onClick={() => { setVoice(null); vr.reset(); }} aria-label="Remove voice note"><Icon name="x" size={14} /></button></div> : null}
      {err ? <div className={`alert ${blocked ? "warn" : "err"}`}>{err}</div> : null}
      {attach && !showOpts && (
        <div className="attach-line">
          <span className="muted tiny">Sharing your contact code in <b>{TIER_NAMES[tier]}</b> mode — people can message or call you.</span>
          <button type="button" className="linkbtn tiny" onClick={() => setShowOpts(true)}>Change</button>
        </div>
      )}
      {showOpts && (
        <div className="stack small">
          {warnShow && <div className="alert warn" style={{ margin: 0 }}>Your contact code is attached by default — people you share with can message or call you. Turn it off any time with the button below.</div>}
          <p className="muted">People open your code to message or call you in PryingEyes. No phone number is involved. Each group gets its own code, which you can switch off on <a href="/dashboard">My codes</a>.</p>
          <div className="chips">{[1, 2, 3].map((n) => <button type="button" key={n} className="chip" aria-pressed={tier === n} onClick={() => setTier(n)}>{TIER_NAMES[n]}</button>)}</div>
          <p className="muted tiny">{TIER_HELP[tier]}</p>
          <KindPicker kind={kind} setKind={setKind} />
          <button type="button" className="linkbtn tiny" onClick={() => setShowOpts(false)}>Done</button>
        </div>
      )}
      <div className="bar">
        <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={pickImage} />
        <button type="button" className={`attach${vr.recording ? " recording" : voice ? " on" : ""}`} aria-pressed={vr.recording || !!voice} onClick={vr.recording ? vr.stop : startVoice} data-testid="attach-voice">
          <Icon name="mic" size={16} /> {vr.recording ? <><span className="rec-dot" />{vr.recTime}s</> : voice ? "Voice note attached" : "Voice note"}
        </button>
        <button type="button" className={`attach ${img ? "on" : ""}`} aria-pressed={!!img} onClick={() => fileRef.current?.click()} disabled={imgBusy} data-testid="attach-image">
          <Icon name="image" size={16} /> {imgBusy ? "Uploading…" : img ? "Media attached" : "Add photo/video"}
        </button>
        <button type="button" className={`attach ${attach ? "on" : ""}`} aria-pressed={attach} onClick={() => { setAttach(!attach); if (attach) setShowOpts(false); }} data-testid="attach-code">
          <Icon name="mark" size={16} /> {attach ? `Contact code · ${TIER_NAMES[tier]}` : "Attach contact code"}
        </button>
        <button className="sendbtn" disabled={busy || (!text.trim() && !attach && !img && !voice)} data-testid="composer-send" aria-label={buttonLabel} title={buttonLabel}><Icon name="send" size={22} /></button>
      </div>
    </form>
  );
}
