"use client";
import { useState } from "react";
import { api, errMsg } from "@/components/api";

export default function Report() {
  const [reason, setReason] = useState("harassment"); const [details, setDetails] = useState("");
  const [done, setDone] = useState(false); const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const requestId = new URLSearchParams(window.location.search).get("request");
    try { await api("/api/reports", { body: { requestId, reason, details } }); setDone(true); } catch (x) { setErr(errMsg(x)); }
  }
  return (
    <div className="narrow">
      <h1>Report a problem</h1>
      <div className="card">
        {done ? <p role="status">Thank you. A moderator will review your report, usually within an hour.</p> : (
          <form onSubmit={submit}>
            {err && <div className="alert err">{err}</div>}
            <div className="field"><label htmlFor="r">Reason</label><select id="r" value={reason} onChange={(e) => setReason(e.target.value)}>{["harassment", "threats", "scam", "spam", "impersonation", "other"].map((x) => <option key={x}>{x}</option>)}</select></div>
            <div className="field"><label htmlFor="d">Details</label><textarea id="d" maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} /></div>
            <button className="btn danger">Send report</button>
          </form>)}
      </div>
    </div>
  );
}
