"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, errMsg, relTime } from "@/components/api";
import { Feed, type FeedEntry } from "@/components/Feed";
import { Status, Tier } from "@/components/Tier";
import { TokenShare } from "@/components/TokenShare";
import { Icon } from "@/components/Icon";

type Tok = { id: string; label: string; class: string; tier: number; status: string; displayPrefix: string; linkCode: string | null; shortCode: string | null; link: string | null; short: string | null; expiresAt: string | null; uses: number; decodeBudget: number | null; rotationDue: boolean; appOnly: boolean; contacts: number; number: { hint: string; label: string } | null };
type Summary = { stats: { activeTokens: number; contactsThisWeek: number; pendingApprovals: number; attemptsBlocked: number; numbers: number }; tokens: Tok[]; feed: FeedEntry[] };

export function DashboardClient() {
  const [d, setD] = useState<Summary | null>(null);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [share, setShare] = useState<{ link: string; short: string; label: string } | null>(null);
  const [copied, setCopied] = useState<string>("");
  const panicRef = useRef<HTMLDialogElement>(null);
  const load = useCallback(() => { if (document.visibilityState !== "visible") return; return api<Summary>("/api/dashboard").then(setD).catch((e) => setErr(errMsg(e))); }, []);
  useEffect(() => {
    void load();
    const id = setInterval(load, 15000);
    document.addEventListener("visibilitychange", load);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", load); };
  }, [load]);

  async function act(t: Tok, action: string, extra: Record<string, unknown> = {}) {
    setErr(""); setMsg("");
    if (action === "revoke" && !confirm(`Revoke "${t.label}"? Anyone holding this code will no longer be able to reach you.`)) return;
    try {
      const r = await api(`/api/tokens/${t.id}`, { body: { action, ...extra } });
      if (r.link) setShare({ link: r.link, short: r.short, label: t.label });
      else setMsg(`"${t.label}" updated.`);
      await load();
    } catch (x) { setErr(errMsg(x)); }
  }
  async function copyCode(t: Tok) {
    if (!t.link) return;
    try { await navigator.clipboard.writeText(t.link); setCopied(t.id); setTimeout(() => setCopied(""), 1800); } catch { /* clipboard unavailable */ }
  }
  async function panic() {
    try { const r = await api("/api/panic", { body: {} }); panicRef.current?.close(); setMsg(`Done. ${r.revoked} code(s) revoked — old links and codes no longer work.`); await load(); }
    catch (x) { setErr(errMsg(x)); panicRef.current?.close(); }
  }
  if (!d) return <div className="page">{err ? <div className="alert err">{err}</div> : <p>Loading…</p>}</div>;
  const s = d.stats;
  return (
    <div className="page">
      <div className="page-head spread">
        <div><p className="eyebrow"><Icon name="shield" size={12} /> Contact codes</p>
          <h1 style={{ marginBottom: 2 }}>My codes</h1>
          <p className="muted small" style={{ margin: 0 }}>Share a code wherever you&apos;d have shared your number. People reach you in PryingEyes.</p></div>
        <div className="row">
          <Link className="btn" href="/dashboard/tokens/new"><Icon name="plus" size={16} />New code</Link>
          <button className="btn danger-ghost" onClick={() => panicRef.current?.showModal()} disabled={s.activeTokens === 0}
            title={s.activeTokens === 0 ? "You have no active codes to revoke" : "Revoke every code at once"} data-testid="panic">
            <Icon name="block" size={16} />Panic: revoke all</button>
        </div>
      </div>
      {err && <div className="alert err" role="alert">{err}</div>}
      {msg && <div className="alert ok" role="status">{msg}</div>}
      {s.pendingApprovals > 0 && <div className="alert info spread"><span><b>{s.pendingApprovals}</b> {s.pendingApprovals === 1 ? "person is" : "people are"} waiting for your approval.</span><Link className="btn sm" href="/dashboard/requests">Review</Link></div>}
      {share && <div className="card" style={{ marginBottom: 14 }}><div className="spread"><h2>New code for "{share.label}"</h2><button className="iconbtn sm" onClick={() => setShare(null)} aria-label="Close" title="Close"><Icon name="x" size={16} /></button></div><TokenShare {...share} /></div>}
      <div className="stats">
        <div className="stat"><b>{s.activeTokens}</b><span>Active codes</span></div>
        <div className="stat"><b>{s.contactsThisWeek}</b><span>Contacts this week</span></div>
        <div className={`stat ${s.pendingApprovals ? "warn" : ""}`}><b>{s.pendingApprovals}</b><span>Awaiting your approval</span></div>
        <div className="stat"><b>{s.attemptsBlocked}</b><span>Attempts blocked (7 days)</span></div>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)" }}>
        <div className="card tablewrap">
          {d.tokens.length === 0 ? (
            <div className="stack">
              <p><b>Create your first code.</b></p>
              <p className="muted small">Give it a name, like &ldquo;Car for sale&rdquo;, and choose how careful to be. Post the code in place of your number. No phone number needed.</p>
              <Link className="btn" href="/dashboard/tokens/new" style={{ alignSelf: "flex-start" }}>New code</Link>
            </div>
          ) : (
            <table className="tbl">
              <thead><tr><th>Label</th><th>Tier</th><th className="hide-sm">Code</th><th>Uses</th><th>Reached</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {d.tokens.map((t) => (
                  <tr key={t.id}>
                    <td><b>{t.label}</b><br /><span className="muted tiny">{t.class}{t.expiresAt ? ` · expires ${relTime(t.expiresAt)}` : ""}{t.number ? ` · phone ··${t.number.hint}` : ""}{t.rotationDue ? " · rotation due" : ""}</span></td>
                    <td><Tier n={t.tier} /></td>
                    <td className="mono small">
  {t.short ? (
    <button type="button" className="codechip" onClick={() => copyCode(t)} title={t.link ?? "Copy link"} aria-label={`Copy code for ${t.label}`}>
      <span>{t.short}</span>{copied === t.id ? <Icon name="check" size={13} /> : <Icon name="copy" size={13} />}
    </button>
  ) : (
    <span className="muted">{t.displayPrefix}-···· <span className="tiny">· rotate to reveal</span></span>
  )}
</td>
                    <td>{t.uses}{t.decodeBudget ? `/${t.decodeBudget}` : ""}</td>
                    <td>{t.contacts}</td>
                    <td><Status s={t.status} /></td>
                    <td>
                      <details className="menu">
                        <summary className="iconbtn sm" aria-label={`Actions for ${t.label}`} title="Actions"><Icon name="more" size={17} /></summary>
                        <div className="pop menu-list">
                          {t.status === "active" && <button className="plain-item" onClick={() => act(t, "pause")}><Icon name="pause" size={15} />Pause</button>}
                          {(t.status === "paused" || t.status === "frozen") && <button className="plain-item" onClick={() => act(t, "resume")}><Icon name="play" size={15} />Resume</button>}
                          {["active", "paused", "frozen", "expired"].includes(t.status) && <button className="plain-item" onClick={() => act(t, "rotate")}><Icon name="refresh" size={15} />Replace with a new code</button>}
                          {t.expiresAt && ["active", "paused", "frozen", "expired"].includes(t.status) && <button className="plain-item" onClick={() => act(t, "extend", { hours: 48 })}><Icon name="clock" size={15} />Extend 48 h</button>}
                          {["active", "paused", "frozen"].includes(t.status) && <button className="plain-item danger" onClick={() => act(t, "revoke")}><Icon name="trash" size={15} />Revoke</button>}
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="spread"><h2>Live audit feed</h2><Link className="small" href="/dashboard/audit">All activity</Link></div>
          <Feed events={d.feed} />
        </div>
      </div>
      <details className="card" style={{ marginTop: 14 }} open={d.tokens.length === 0 || undefined}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>How people reach you</summary>
        <div className="how" style={{ marginTop: 12 }}>
          <div className="step"><span className="n">1</span><b>Share a code</b><span className="small muted">Post its link or short code wherever you&apos;d normally put your number, or attach it to a group post. Its tier sets which checks people pass first.</span></div>
          <div className="step"><span className="n">2</span><b>They chat with you</b><span className="small muted">They can message you in the app. You get a notification and an unread badge on <Link href="/chats">Chats</Link>; reply there. Numbers are never shown.</span></div>
          <div className="step"><span className="n">3</span><b>Or call you in the app</b><span className="small muted">While PryingEyes is open, an incoming call rings on screen — answer or decline. If it's closed, you get a missed-call notification and can reply in the chat. No phone numbers are used.</span></div>
          <div className="step"><span className="n">4</span><b>Approve, block or revoke</b><span className="small muted">Tier 3 requests wait in <Link href="/dashboard/requests">Requests</Link> for you. Block or report from any chat, and revoke a code whenever you like.</span></div>
        </div>
      </details>
      {s.numbers === 0 && (
        <p className="small muted" style={{ marginTop: 14 }}>
          Want approved people to be able to see your actual number? <Link href="/onboarding">Add a phone number</Link> (optional).
        </p>
      )}
      <dialog ref={panicRef} aria-labelledby="panic-title">
        <h2 id="panic-title">Revoke every code?</h2>
        <p>All your links and codes stop working immediately and pending requests are cancelled. Use this if you feel unsafe. You&apos;ll need to confirm it&apos;s you before creating new codes.</p>
        <div className="row"><button className="btn danger" onClick={panic} data-testid="panic-confirm">Yes, revoke everything</button><button className="btn ghost" onClick={() => panicRef.current?.close()}>Cancel</button></div>
      </dialog>
    </div>
  );
}
