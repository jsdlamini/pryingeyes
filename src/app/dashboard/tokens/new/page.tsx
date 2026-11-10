"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, errMsg } from "@/components/api";
import { Tier, TIER_LINES } from "@/components/Tier";
import { TokenShare } from "@/components/TokenShare";

const CONTEXTS = [["business", "Business"], ["classifieds", "Classifieds"], ["community", "Community group"], ["marketplace", "Marketplace"], ["dating", "Dating"], ["new_contact", "Someone new"], ["other", "Other"]] as const;
const TIERS = [1, 2, 3].map((n) => ({ n, p: TIER_LINES[n] }));
const DURATIONS = [["standard", null, "Until I switch it off"], ["expiring", 24, "24 hours"], ["expiring", 48, "48 hours"], ["expiring", 168, "7 days"], ["disposable", null, "One person only"]] as const;
type Num = { id: string; label: string; hint: string; activeTokens: number };

/** One short form: a name, how careful, how long. A phone number is an optional extra. */
export default function NewCode() {
  const [ctx, setCtx] = useState<string>("marketplace");
  const [rec, setRec] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [label, setLabel] = useState(""); const [tier, setTier] = useState(2); const [dur, setDur] = useState(0);
  const [numbers, setNumbers] = useState<Num[]>([]); const [numberId, setNumberId] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ link: string; short: string; label: string } | null>(null);

  useEffect(() => { api("/api/me").then((m) => (m.numbers > 0 && m.owner.mfa ? api("/api/numbers").then((r) => setNumbers(r.numbers)) : null)).catch(() => undefined); }, []);
  useEffect(() => {
    api(`/api/tokens?recommend=${ctx}`).then((r) => {
      setRec(r.recommendation.tier); setTier(r.recommendation.tier);
      setDur(r.recommendation.class === "expiring" ? 2 : 0);
    }).catch(() => undefined);
  }, [ctx]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    const [cls, hours] = DURATIONS[dur];
    try {
      const r = await api("/api/tokens", { body: { label, tier, class: cls, ttlHours: hours, context: ctx, numberId: numberId || null } });
      setMade({ link: r.link, short: r.short, label });
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  if (made) return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1>Ready to share</h1>
      <div className="card"><TokenShare {...made} onSavedChange={setSaved} /></div>
      <div className="row" style={{ marginTop: 14 }}>
        {saved ? <Link className="btn" href="/dashboard">Done</Link> : <button className="btn" disabled aria-describedby="done-hint">Done</button>}
        <button className="btn ghost" disabled={!saved} onClick={() => { setMade(null); setLabel(""); setSaved(false); }}>Create another</button>
      </div>
      {!saved && <p id="done-hint" className="muted small" style={{ marginTop: 6 }}>Copy, share or save the code to continue.</p>}
    </div>
  );
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1>New code</h1>
      {err && <div className="alert err" role="alert">{err}</div>}
      <form onSubmit={create} className="card stack">
        <div className="field" style={{ marginBottom: 0 }}><label htmlFor="label">Name</label>
          <input id="label" type="text" maxLength={40} required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Car for sale" />
          <p className="hint">People see it when they use the code, so they know what they&apos;re contacting you about.</p></div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend><b>Where will you share it?</b></legend>
          <div className="chips" style={{ marginTop: 8 }}>
            {CONTEXTS.map(([v, l]) => <button type="button" key={v} className="chip" aria-pressed={ctx === v} onClick={() => setCtx(v)}>{l}</button>)}
          </div>
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend><b>How careful should we be?</b></legend>
          <div className="tiers" style={{ marginTop: 8 }}>
            {TIERS.map((t) => (
              <button type="button" key={t.n} className="tiercard" aria-pressed={tier === t.n} onClick={() => setTier(t.n)}>
                <Tier n={t.n} /> {rec === t.n && <span className="tiny" style={{ color: "var(--accent)", fontWeight: 700 }}>Recommended</span>}
                <p>{t.p}</p>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="field" style={{ marginBottom: 0 }}><label htmlFor="dur">How long should it work?</label>
          <select id="dur" value={dur} onChange={(e) => setDur(Number(e.target.value))}>
            {DURATIONS.map(([, , l], i) => <option key={l} value={i}>{l}</option>)}
          </select></div>
        {numbers.length > 0 ? (
          <div className="field" style={{ marginBottom: 0 }}><label htmlFor="num">Show my number (optional)</label>
            <select id="num" value={numberId} onChange={(e) => setNumberId(e.target.value)}>
              <option value="">No: messages and in-app calls only</option>
              {numbers.map((n) => <option key={n.id} value={n.id}>{n.label || "Number"} (··{n.hint})</option>)}
            </select>
            <p className="hint">With a number, people who pass the checks can also see it once, as a watermarked image.</p></div>
        ) : null}
        <button className="btn accent" disabled={busy || !label.trim()} style={{ alignSelf: "flex-start" }}>Create code</button>
      </form>
    </div>
  );
}
