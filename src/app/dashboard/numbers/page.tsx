"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, errMsg } from "@/components/api";
import { PhoneInput, initialPhone, phoneBody, phoneValid, type PhoneValue } from "@/components/PhoneInput";

export default function Numbers() {
  const [ns, setNs] = useState<any[] | null>(null);
  const [phone, setPhone] = useState<PhoneValue>({ country: "SZ", number: "" }); const [label, setLabel] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  // Numbers need two-step sign-in first; the set-up page walks through it.
  const load = useCallback(() => api("/api/numbers").then((r) => setNs(r.numbers))
    .catch((e) => { if (e instanceof ApiError && e.code === "owner_setup_required") window.location.href = "/onboarding"; else setErr(errMsg(e)); }), []);
  useEffect(() => { load(); setPhone(initialPhone()); }, [load]);
  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await api("/api/numbers", { body: { ...phoneBody(phone), label } }); setPhone({ ...phone, number: "" }); setLabel(""); await load(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!confirm("Remove this number? Codes that use it stop working.")) return;
    try { await api(`/api/numbers/${id}`, { method: "DELETE" }); await load(); } catch (x) { setErr(errMsg(x)); }
  }
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1>Show my number</h1>
      <p className="muted small">Optional. Codes that use a number let people who pass the checks see it once, as a watermarked image. The number itself is never shown in groups, chats or calls.</p>
      {err && <div className="alert err" role="alert">{err}</div>}
      <div className="card">
        {!ns ? <p>Loading…</p> : ns.length === 0 ? <p className="muted">No numbers yet.</p> : (
          <table className="tbl"><thead><tr><th>Name</th><th>Ends in</th><th>Active codes</th><th /></tr></thead>
            <tbody>{ns.map((n) => <tr key={n.id}><td>{n.label || "Number"}</td><td className="mono">··{n.hint}</td><td>{n.activeTokens}/10</td>
              <td><button className="btn danger-ghost sm" onClick={() => remove(n.id)}>Remove</button></td></tr>)}</tbody></table>
        )}
      </div>
      <form className="card" onSubmit={add}>
        <h2>Add a number</h2>
        <div className="grid2">
          <PhoneInput id="ph" label="Phone number" value={phone} onChange={setPhone} autoComplete="off" />
          <div className="field"><label htmlFor="lb">Name (only you see it)</label><input id="lb" type="text" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} /></div>
        </div>
        <button className="btn" disabled={busy || !phoneValid(phone)}>Add number</button>
        <p className="hint">Encrypted immediately. We store only the last two digits in readable form, so you can tell your numbers apart.</p>
      </form>
    </div>
  );
}
