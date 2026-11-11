"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, errMsg, relTime } from "@/components/api";
import { useConfirm } from "@/components/Confirm";
import { Feed, type FeedEntry } from "@/components/Feed";
import { Tier, TIER_LINES } from "@/components/Tier";
import { TokenShare } from "@/components/TokenShare";
import { Icon } from "@/components/Icon";

type Tok = { id: string; label: string; class: string; tier: number; status: string; displayPrefix: string; expiresAt: string | null; uses: number; decodeBudget: number | null; rotationDue: boolean; appOnly: boolean; contacts: number; number: { hint: string; label: string } | null };
type Summary = { stats: { activeTokens: number; contactsThisWeek: number; pendingApprovals: number; attemptsBlocked: number; numbers: number }; tokens: Tok[]; feed: FeedEntry[] };

const LIVE = ["active", "paused", "frozen"];
const STATE_WORDS: Record<string, string> = { active: "Active", paused: "Paused", frozen: "Frozen", expired: "Expired", revoked: "Revoked", consumed: "Used" };
const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

/** Home: what needs you first, then each live code as a "pass", then one clear action. */
export function DashboardClient() {
  const confirm = useConfirm();
  const [d, setD] = useState<Summary | null>(null);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [share, setShare] = useState<{ link: string; short: string; label: string } | null>(null);
  const [shareSaved, setShareSaved] = useState(false);
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
    if (action === "revoke" && !(await confirm(`Revoke "${t.label}"? Anyone holding this code will no longer be able to reach you.`, { danger: true, confirmLabel: "Revoke" }))) return;
    if (action === "rotate" && !(await confirm(`Replace "${t.label}" with a new code? The old code stops working; the new one keeps the same name and settings.`, { confirmLabel: "Replace" }))) return;
    if (action === "delete" && !(await confirm(`Delete "${t.label}" permanently? It will be removed and can never be used again.`, { danger: true, confirmLabel: "Delete" }))) return;
    try {
      const r = await api(`/api/tokens/${t.id}`, { body: { action, ...extra } });
      if (r.link) { setShare({ link: r.link, short: r.short, label: t.label }); window.scrollTo({ top: 0, behavior: "smooth" }); }
      else setMsg(`"${t.label}" updated.`);
      await load();
    } catch (x) { setErr(errMsg(x)); }
  }
  async function panic() {
    try { const r = await api("/api/panic", { body: {} }); panicRef.current?.close(); setMsg(`Done. ${r.revoked} code(s) revoked — old links and codes no longer work.`); await load(); }
    catch (x) { setErr(errMsg(x)); panicRef.current?.close(); }
  }
  if (!d) return <div className="page home">{err ? <div className="alert err">{err}</div> : <p>Loading…</p>}</div>;
  const s = d.stats;
  const live = d.tokens.filter((t) => LIVE.includes(t.status));
  const past = d.tokens.filter((t) => !LIVE.includes(t.status));

  return (
    <div className="page home">
      <p className="eyebrow"><Icon name="shield" size={12} /> Contact codes</p>
      <h1 className="home-title">Your codes</h1>
      <p className="muted small" style={{ margin: "0 0 14px" }}>To call someone — or be called — share a code. It&apos;s how people reach you in PryingEyes, without ever seeing your number.</p>
      {err && <div className="alert err" role="alert">{err}</div>}
      {msg && <div className="alert ok" role="status">{msg}</div>}

      {s.pendingApprovals > 0 && (
        <Link href="/dashboard/requests" className="banner-requests" data-testid="requests-banner">
          <span className="ico"><Icon name="userPlus" size={20} /></span>
          <span className="txt"><b>{people(s.pendingApprovals)} {s.pendingApprovals === 1 ? "wants" : "want"} to reach you</b>
            <span className="sub">Waiting for your yes or no</span></span>
          <span className="go">Review</span>
        </Link>
      )}

      {share && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="spread"><h2>New code for &ldquo;{share.label}&rdquo;</h2>
            <button className="iconbtn sm" onClick={async () => { if (shareSaved || await confirm("You won't see this code again. Close without copying, sharing or saving it?", { confirmLabel: "Close anyway" })) setShare(null); }} aria-label="Close" title="Close"><Icon name="x" size={16} /></button></div>
          <TokenShare {...share} onSavedChange={setShareSaved} />
        </div>
      )}

      {live.length === 0 ? (
        <div className="card stack">
          <p style={{ margin: 0 }}><b>Create your first code.</b></p>
          <p className="muted small" style={{ margin: 0 }}>Give it a name and choose who can reach you — then share it so people can message or call you. Post the code where you&apos;d have put your number.</p>
        </div>
      ) : (
        <div className="pass-grid">
          {live.map((t) => (
            <section key={t.id} className={`pass${t.status === "active" ? "" : " quiet"}`} aria-label={`${t.label} code`} data-testid="code-pass">
              <div className="pass-top">
                <span className="pass-name"><span>{t.label}</span><Tier n={t.tier} /></span>
                <span className={`state ${t.status}`} style={{ marginRight: 30 }}>{STATE_WORDS[t.status] ?? t.status}</span>
              </div>
              <p className="pass-line">{TIER_LINES[t.tier]}</p>
              <div className="pass-code" aria-label={`Code starting ${t.displayPrefix}`}>{t.displayPrefix}<span className="hid">-•••••</span></div>
              <div className="pass-chips">
                <span className="pass-chip">{t.contacts ? `${people(t.contacts)} reached you` : "No one yet"}</span>
                <span className="pass-chip v">{t.number ? `Phone ··${t.number.hint} behind it` : "No number behind it"}</span>
                {t.expiresAt && <span className="pass-chip w">Expires {relTime(t.expiresAt)}</span>}
                {t.decodeBudget ? <span className="pass-chip w">{t.uses}/{t.decodeBudget} uses</span> : null}
                {t.rotationDue && <span className="pass-chip w">Time to replace</span>}
              </div>
              <div className="pass-actions">
                {t.status === "active"
                  ? <button onClick={() => act(t, "pause")}><Icon name="pause" size={16} className="icon ic-amber" />Pause</button>
                  : <button onClick={() => act(t, "resume")}><Icon name="play" size={16} className="icon ic-amber" />Resume</button>}
                <button onClick={() => act(t, "rotate")}><Icon name="refresh" size={16} className="icon ic-cyan" />Replace</button>
                <Link href="/dashboard/audit"><Icon name="log" size={16} className="icon ic-violet" />Activity</Link>
              </div>
              <details className="menu pass-more">
                <summary className="iconbtn sm plain" aria-label={`More for ${t.label}`} title="More"><Icon name="more" size={17} /></summary>
                <div className="pop menu-list">
                  {t.expiresAt && <button className="plain-item" onClick={() => act(t, "extend", { hours: 48 })}><Icon name="clock" size={15} />Extend 48 h</button>}
                  <button className="plain-item danger" onClick={() => act(t, "revoke")}><Icon name="trash" size={15} />Revoke</button>
                  <button className="plain-item danger" onClick={() => act(t, "delete")}><Icon name="trash" size={15} />Delete permanently</button>
                </div>
              </details>
            </section>
          ))}
        </div>
      )}

      <div className="share-cta"><Link className="btn cta" href="/dashboard/tokens/new" data-testid="new-code"><Icon name="share" size={18} />Share a new code</Link></div>
      <p className="home-note">Each code is shown once. Lost one? Tap Replace.</p>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="spread"><h2>Recent activity</h2><Link className="small" href="/dashboard/audit">All activity</Link></div>
          <Feed events={d.feed} />
        </div>
        <div className="card">
          <h2>This week</h2>
          <div className="stats" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
            <div className="stat"><b>{s.activeTokens}</b><span>Active codes</span></div>
            <div className="stat"><b>{s.contactsThisWeek}</b><span>People reached you</span></div>
            <div className={`stat ${s.pendingApprovals ? "warn" : ""}`}><b>{s.pendingApprovals}</b><span>Waiting for you</span></div>
            <div className="stat"><b>{s.attemptsBlocked}</b><span>Attempts blocked</span></div>
          </div>
          {past.length > 0 && (
            <details className="past-codes">
              <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>Old codes ({past.length})</summary>
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
                {past.slice(0, 20).map((t) => (
                  <li key={t.id}><span className="small"><b>{t.label}</b> <span className="mono muted">{t.displayPrefix}-•••••</span></span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}><span className={`state ${t.status}`}>{STATE_WORDS[t.status] ?? t.status}</span>
                      {t.status === "expired" && <button className="btn ghost sm" onClick={() => act(t, "rotate")}>Renew</button>}</span></li>
                ))}
              </ul>
            </details>
          )}
          {s.numbers === 0 && <p className="small muted" style={{ margin: "12px 0 0" }}>Want approved people to be able to see your number? <Link href="/onboarding">Add a phone number</Link> (optional).</p>}
        </div>
      </div>

      <div className="safety-zone">
        <span className="small"><b>Feel unsafe?</b> <span className="muted">Switch off every code at once. Old links stop working immediately.</span></span>
        <button className="btn danger-ghost sm" onClick={() => panicRef.current?.showModal()} disabled={s.activeTokens === 0}
          title={s.activeTokens === 0 ? "You have no active codes to revoke" : "Revoke every code at once"} data-testid="panic">
          <Icon name="block" size={16} />Revoke all codes</button>
      </div>

      <dialog ref={panicRef} aria-labelledby="panic-title">
        <h2 id="panic-title">Revoke every code?</h2>
        <p>All your links and codes stop working immediately and pending requests are cancelled. Use this if you feel unsafe. You&apos;ll need to confirm it&apos;s you before creating new codes.</p>
        <div className="row"><button className="btn danger" onClick={panic} data-testid="panic-confirm">Yes, revoke everything</button><button className="btn ghost" onClick={() => panicRef.current?.close()}>Cancel</button></div>
      </dialog>
    </div>
  );
}
