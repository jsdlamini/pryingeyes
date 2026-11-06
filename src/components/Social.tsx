"use client";
import { useState } from "react";
import { api, ApiError, errMsg, relTime } from "./api";
import { Icon } from "./Icon";
import { Tier } from "./Tier";

export type CodeKind = "standard" | "day" | "one";
export type CodeView = { short: string; link: string; tier: number; live: boolean; state?: "live" | "used" | "expired" | "off"; kind?: CodeKind };
const KIND_LABEL: Record<CodeKind, string> = { standard: "", day: "24 hours", one: "One person" };
const OFF_TEXT = { used: "This one-person code has already been used.", expired: "This contact code has expired.", off: "This contact code has been switched off." };
export type PostView = {
  id: string; at: string; expiresAt: string | null; text: string; mine: boolean; canDelete: boolean;
  author: { id: string; handle: string }; code: CodeView | null;
};

const CODE_IN_TEXT = /(https?:\/\/[^\s]+\/t\/[0-9A-Za-z-]{16,24}|\b[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}\b)/g;
const codePath = (s: string) => `/t/${encodeURIComponent(s.match(/\/t\/([0-9A-Za-z-]+)/)?.[1] ?? s.replace("-", ""))}`;

/** Post text with PryingEyes codes and code links made into links to the gate. */
export function PostText({ text }: { text: string }) {
  const parts = text.split(CODE_IN_TEXT);
  return <p className="post-text">{parts.map((p, i) => (i % 2 === 1 ? <a key={i} href={codePath(p)} rel="noreferrer">{p}</a> : p))}</p>;
}

/** Chat message text: any code or code link becomes a tappable "contact code" chip that opens the gate. */
export function MessageText({ text, mine }: { text: string; mine: boolean }) {
  const parts = text.split(CODE_IN_TEXT);
  return <>{parts.map((p, i) => (i % 2 === 1
    ? (mine ? <span key={i} className="code-chip mine"><Icon name="mark" size={14} /> Your contact code</span>
      : <a key={i} className="code-chip" href={codePath(p)} data-testid="chat-code"><Icon name="mark" size={14} /> Open contact code</a>)
    : p.trim() ? <span key={i} style={{ whiteSpace: "pre-wrap" }}>{p}</span> : null))}</>;
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
    <span className="code-card-mark"><Icon name="mark" size={22} /></span>
    <span className="code-card-body"><b>{mine ? "Your contact code" : `Reach @${handle}`}</b><span className="code-card-code">{code.short}{code.kind && code.kind !== "standard" ? ` · ${KIND_LABEL[code.kind]}` : ""}</span></span>
    <Tier n={code.tier} />
  </>;
  return mine ? <div className="code-card">{inner}</div> : <a className="code-card" href={codePath(code.link)} data-testid="code-card">{inner}</a>;
}

const REASONS = ["scam", "harassment", "spam", "threats", "impersonation", "other"];

export function PostCard({ p, onChanged }: { p: PostView; onChanged: () => void }) {
  const [reporting, setReporting] = useState(false); const [err, setErr] = useState("");
  const del = () => { if (confirm("Delete this post for everyone?")) api(`/api/posts/${p.id}`, { method: "DELETE" }).then(onChanged).catch((e) => setErr(errMsg(e))); };
  const report = (reason: string) => api(`/api/posts/${p.id}/report`, { body: { reason, block: true } }).then(() => { setReporting(false); onChanged(); }).catch((e) => setErr(errMsg(e)));
  return (
    <article className="post" data-testid="post">
      <div className="spread"><span><b>{p.mine ? "You" : `@${p.author.handle}`}</b> <span className="muted small">{relTime(p.at)}</span></span>
        <span className="row">
          {p.canDelete ? <button className="iconbtn sm plain danger" onClick={del} aria-label="Delete" title="Delete post"><Icon name="trash" size={17} /></button> : null}
          {!p.mine ? <button className="iconbtn sm plain" onClick={() => setReporting((x) => !x)} aria-label="Report" title="Report" aria-pressed={reporting}><Icon name="flag" size={17} /></button> : null}
        </span>
      </div>
      {p.text ? <PostText text={p.text} /> : null}
      {p.code ? <CodeCard code={p.code} handle={p.author.handle} mine={p.mine} /> : null}
      {reporting ? <div className="stack" style={{ marginTop: 10 }}>
        <p className="small muted">The post goes to a moderator and the group admins, and you won&apos;t see posts from @{p.author.handle} any more.</p>
        <div className="chips">{REASONS.map((r) => <button key={r} className="chip" onClick={() => report(r)}>{r[0].toUpperCase() + r.slice(1)}</button>)}</div>
      </div> : null}
      {err ? <div className="alert err" style={{ marginTop: 8 }}>{err}</div> : null}
    </article>
  );
}

const TIER_HELP: Record<number, string> = { 1: "Anyone verified can message or call you right away.", 2: "They also confirm a code sent to their email.", 3: "You approve each person first." };

/** Post box with "Attach my contact code". Phone numbers in the text are refused with an explanation. */
export function Composer({ placeholder, onPost }: { placeholder: string; onPost: (b: { text: string; attach: { tier: number; kind: CodeKind } | null }) => Promise<unknown> }) {
  const [text, setText] = useState(""); const [attach, setAttach] = useState(false); const [tier, setTier] = useState(2); const [kind, setKind] = useState<CodeKind>("standard");
  const [err, setErr] = useState(""); const [blocked, setBlocked] = useState(false); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(""); setBlocked(false);
    try { await onPost({ text, attach: attach ? { tier, kind } : null }); setText(""); setAttach(false); setKind("standard"); }
    catch (x) { setErr(errMsg(x)); if (x instanceof ApiError && x.code === "contact_info_detected") { setBlocked(true); setAttach(true); } }
    finally { setBusy(false); }
  }
  return (
    <form className="card composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="composer">{placeholder}</label>
      <textarea id="composer" placeholder={placeholder} value={text} maxLength={1000} rows={3} onChange={(e) => { setText(e.target.value); setBlocked(false); }} data-testid="composer-input" />
      {err ? <div className={`alert ${blocked ? "warn" : "err"}`}>{err}</div> : null}
      {attach ? (
        <div className="stack small">
          <p className="muted">People open your code to message or call you in PryingEyes. No phone number is involved. Each group gets its own code, which you can switch off on <a href="/dashboard">My codes</a>.</p>
          <div className="chips">{[1, 2, 3].map((n) => <button type="button" key={n} className="chip" aria-pressed={tier === n} onClick={() => setTier(n)}>{["", "Open", "Verified", "Consent"][n]}</button>)}</div>
          <p className="muted tiny">{TIER_HELP[tier]}</p>
          <KindPicker kind={kind} setKind={setKind} />
        </div>
      ) : null}
      <div className="spread">
        <button type="button" className={`attach ${attach ? "on" : ""}`} aria-pressed={attach} onClick={() => setAttach(!attach)} data-testid="attach-code">
          <Icon name="mark" size={16} /> {attach ? "Contact code attached" : "Attach my contact code"}
        </button>
        <button className="sendbtn" disabled={busy || (!text.trim() && !attach)} data-testid="composer-send" aria-label="Post" title="Post"><Icon name="send" size={24} /></button>
      </div>
    </form>
  );
}
