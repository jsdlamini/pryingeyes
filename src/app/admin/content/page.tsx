"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg, relTime } from "@/components/api";

const CATS = ["job", "scholarship", "scam_alert", "tender", "service_notice", "weather"] as const;
const CAT_LABEL: Record<string, string> = { job: "Jobs", scholarship: "Scholarships", scam_alert: "Scam alerts", tender: "Tenders", service_notice: "Service notices", weather: "Weather" };
const COUNTRIES = ["SZ", "ZA", "MZ", "BW", "LS", "ZW", "NA", "ZM"];

type Tab = "queue" | "sources" | "routes";

export default function ContentAdmin() {
  const [tab, setTab] = useState<Tab>("queue");
  const [state, setState] = useState<any | null>(null);
  const [sources, setSources] = useState<any[] | null>(null);
  const [items, setItems] = useState<any[] | null>(null);
  const [routes, setRoutes] = useState<any[] | null>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [src, setSrc] = useState({ name: "", url: "", category: "job", country: "SZ", intervalHours: 6, mode: "rules", rules: "" });
  const [route, setRoute] = useState({ country: "SZ", category: "job", groupId: "" });

  const loadState = useCallback(() => api("/api/admin/content/state").then((r) => setState(r.state)).catch((e) => setErr(errMsg(e))), []);
  const loadSources = useCallback(() => api("/api/admin/content/sources").then((r) => setSources(r.sources)).catch((e) => setErr(errMsg(e))), []);
  const loadItems = useCallback(() => api("/api/admin/content/items?status=all").then((r) => setItems(r.items)).catch((e) => setErr(errMsg(e))), []);
  const loadRoutes = useCallback(() => api("/api/admin/content/routes").then((r) => setRoutes(r.routes)).catch((e) => setErr(errMsg(e))), []);
  const loadGroups = useCallback(() => api("/api/groups").then((r) => setGroups(r.groups ?? [])).catch(() => undefined), []);

  useEffect(() => { loadState(); loadSources(); loadItems(); loadRoutes(); loadGroups(); }, [loadState, loadSources, loadItems, loadRoutes, loadGroups]);

  async function pause(v: boolean) {
    setErr(""); setMsg("");
    try { await api("/api/admin/content/state", { method: "POST", body: { paused: v } }); setMsg(v ? "Paused. No new notices will be fetched." : "Resumed. The bot will fetch on its next tick."); await loadState(); } catch (x) { setErr(errMsg(x)); }
  }
  async function runNow() {
    setErr(""); setMsg("");
    try { await api("/api/admin/content/run", { method: "POST" }); setMsg("Ran the bot loop (fetch + extract)."); await loadState(); await loadItems(); await loadSources(); } catch (x) { setErr(errMsg(x)); }
  }
  async function addSource(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    try { await api("/api/admin/content/sources", { method: "POST", body: { name: src.name, url: src.url, category: src.category, country: src.country, intervalHours: Number(src.intervalHours), mode: src.mode, rules: src.rules.trim() || null } }); setMsg("Source added."); setSrc({ ...src, name: "", url: "", rules: "" }); await loadSources(); } catch (x) { setErr(errMsg(x)); }
  }
  async function toggleSource(s: any) {
    setErr("");
    try { await api("/api/admin/content/sources", { method: "PATCH", body: { id: s.id, enabled: !s.enabled } }); await loadSources(); } catch (x) { setErr(errMsg(x)); }
  }
  async function delSource(id: string) {
    setErr("");
    try { await api(`/api/admin/content/sources?id=${encodeURIComponent(id)}`, { method: "DELETE" }); await loadSources(); } catch (x) { setErr(errMsg(x)); }
  }
  async function setStatus(id: string, status: string) {
    setErr("");
    try { await api("/api/admin/content/items", { method: "PATCH", body: { id, status } }); await loadItems(); } catch (x) { setErr(errMsg(x)); }
  }
  async function addRoute(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    if (!route.groupId) return setErr("Pick a group.");
    try { await api("/api/admin/content/routes", { method: "PUT", body: route }); setMsg("Route saved."); await loadRoutes(); } catch (x) { setErr(errMsg(x)); }
  }
  async function delRoute(id: string) {
    setErr("");
    try { await api(`/api/admin/content/routes?id=${encodeURIComponent(id)}`, { method: "DELETE" }); await loadRoutes(); } catch (x) { setErr(errMsg(x)); }
  }

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <h1>Content bot</h1>
      <p className="muted small">Fetches public notices (jobs, scholarships, scam alerts, tenders, service notices, weather) and queues them for review. Off unless <code>CONTENT_BOT=on</code> is set, and it starts paused.</p>
      {err && <div className="alert err">{err}</div>}{msg && <div className="alert ok">{msg}</div>}

      {state && (
        <div className="card row" style={{ alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span>
            <b>{state.enabled ? "On" : "Off"}</b> · {state.paused ? "Paused" : "Running"}
            {state.lastRunAt ? ` · last ran ${relTime(state.lastRunAt)}` : " · never ran"}
            {" · "}{state.queueNew} queued · {state.dailyCount} today
          </span>
          <span className="row" style={{ gap: 6 }}>
            <button className="btn sm ghost" onClick={() => runNow()} disabled={!state.enabled}>Run now</button>
            <button className={`btn sm ${state.paused ? "" : "ghost"}`} onClick={() => pause(!state.paused)} disabled={!state.enabled}>{state.paused ? "Resume" : "Pause"}</button>
          </span>
        </div>
      )}

      <div className="row" style={{ gap: 6, margin: "12px 0" }}>
        {(["queue", "sources", "routes"] as Tab[]).map((t) => (
          <button key={t} className={`btn sm ${tab === t ? "" : "ghost"}`} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === "queue" && (
        <div className="card">
          <h2>Queue</h2>
          <p className="muted small">Fetched notices. The AI summarises them; confident ones are marked ready, the rest wait for your review.</p>
          {!items ? <p>Loading…</p> : items.length === 0 ? <p className="muted small">Nothing queued yet.</p> : (
            <div className="tablewrap"><table className="tbl"><thead><tr><th>Notice</th><th>Kind</th><th>Place</th><th>Deadline</th><th>Status</th><th></th></tr></thead>
              <tbody>{items.map((it) => (
                <tr key={it.id}>
                  <td className="small">
                    <b>{it.title}</b>{it.summary ? <><br /><span className="muted tiny">{it.summary.slice(0, 160)}{it.summary.length > 160 ? "…" : ""}</span></> : null}
                    <br /><span className="muted tiny">{it.sourceName ?? "?"} · <a href={it.url} target="_blank" rel="noreferrer noopener">source</a></span>
                  </td>
                  <td className="small">{CAT_LABEL[it.category] ?? it.category}</td>
                  <td className="small">{it.country}{it.region ? ` · ${it.region}` : ""}</td>
                  <td className="small">{it.deadline ? relTime(it.deadline) : "—"}</td>
                  <td className="small">{it.status}{it.confidence != null ? ` · ${Math.round(it.confidence * 100)}%` : ""}</td>
                  <td><div className="row" style={{ gap: 4 }}>
                    {it.status === "needs_review" ? <button className="btn ghost sm" onClick={() => setStatus(it.id, "ready")}>Approve</button> : null}
                    {it.status !== "discarded" ? <button className="btn ghost sm danger" onClick={() => setStatus(it.id, "discarded")}>Discard</button> : null}
                  </div></td>
                </tr>))}</tbody></table></div>
          )}
        </div>
      )}

      {tab === "sources" && (
        <div className="card">
          <h2>Sources</h2>
          <form onSubmit={addSource} className="stack" style={{ gap: 8, marginBottom: 12 }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input value={src.name} onChange={(e) => setSrc({ ...src, name: e.target.value })} placeholder="Name" aria-label="Name" style={{ minWidth: 140 }} required />
              <input value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} placeholder="https://…" aria-label="URL" style={{ minWidth: 220 }} required />
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={src.category} onChange={(e) => setSrc({ ...src, category: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</select>
              <select value={src.country} onChange={(e) => setSrc({ ...src, country: e.target.value })}>{COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <label className="small">Every <input type="number" min={1} max={168} value={src.intervalHours} onChange={(e) => setSrc({ ...src, intervalHours: Number(e.target.value) })} style={{ width: 70 }} /> hours</label>
              <select value={src.mode} onChange={(e) => setSrc({ ...src, mode: e.target.value })}><option value="rules">rules</option><option value="ai">ai</option></select>
              <button className="btn sm">Add</button>
            </div>
            <input value={src.rules} onChange={(e) => setSrc({ ...src, rules: e.target.value })} placeholder='Rules JSON (optional), e.g. {"itemRegex":"<article[^>]*>[\\s\\S]*?<\\/article>"}' aria-label="Rules" />
          </form>
          {!sources ? <p>Loading…</p> : sources.length === 0 ? <p className="muted small">No sources yet.</p> : (
            <div className="tablewrap"><table className="tbl"><thead><tr><th>Name</th><th>Kind</th><th>Country</th><th>Every</th><th>Trust</th><th>Fetched</th><th>Actions</th></tr></thead>
              <tbody>{sources.map((s) => (
                <tr key={s.id}>
                  <td className="small"><b>{s.name}</b><br /><span className="muted tiny">{s.url}</span></td>
                  <td className="small">{CAT_LABEL[s.category] ?? s.category} · {s.mode}</td>
                  <td className="small">{s.country}</td>
                  <td className="small">{s.intervalHours}h</td>
                  <td className="small">{Math.round((s.trust ?? 0) * 100)}%</td>
                  <td className="small">{s.lastFetchedAt ? relTime(s.lastFetchedAt) : "never"}</td>
                  <td><div className="row" style={{ gap: 4 }}><button className="btn ghost sm" onClick={() => toggleSource(s)}>{s.enabled ? "Disable" : "Enable"}</button><button className="btn ghost sm danger" onClick={() => delSource(s.id)}>Delete</button></div></td>
                </tr>))}</tbody></table></div>
          )}
        </div>
      )}

      {tab === "routes" && (
        <div className="card">
          <h2>Routes</h2>
          <p className="muted small">Where each country + kind gets posted. Point them at official notice boards.</p>
          <form onSubmit={addRoute} className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <select value={route.country} onChange={(e) => setRoute({ ...route, country: e.target.value })}>{COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <select value={route.category} onChange={(e) => setRoute({ ...route, category: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</select>
            <select value={route.groupId} onChange={(e) => setRoute({ ...route, groupId: e.target.value })} style={{ minWidth: 180 }}>
              <option value="">Pick a group…</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button className="btn sm">Save</button>
          </form>
          {!routes ? <p>Loading…</p> : routes.length === 0 ? <p className="muted small">No routes yet.</p> : (
            <div className="tablewrap"><table className="tbl"><thead><tr><th>Country</th><th>Kind</th><th>Group</th><th></th></tr></thead>
              <tbody>{routes.map((r) => (
                <tr key={r.id}>
                  <td className="small">{r.country}</td><td className="small">{CAT_LABEL[r.category] ?? r.category}</td><td className="small">{r.groupName}</td>
                  <td><button className="btn ghost sm danger" onClick={() => delRoute(r.id)}>Remove</button></td>
                </tr>))}</tbody></table></div>
          )}
        </div>
      )}
    </div>
  );
}
