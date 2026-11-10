"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, errMsg } from "@/components/api";
import { uploadImage } from "@/components/upload";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";

type Blocked = { id: string; handle: string; at: string };

export default function AccountPage() {
  const [me, setMe] = useState<{ handle?: string; roles?: string[]; avatarUrl?: string | null } | null>(null);
  const [blocked, setBlocked] = useState<Blocked[] | null>(null);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api("/api/me").then((r) => setMe(r.user)).catch(() => {});
    api("/api/social/blocks").then((r) => setBlocked(r.blocked)).catch((e) => setErr(errMsg(e)));
  }, []);
  const roles = me?.roles ?? [];
  const moderator = roles.includes("moderator") || roles.includes("admin");
  const admin = roles.includes("admin");
  async function signOut() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/"; }
  async function unblock(h: string) {
    setErr("");
    try { await api("/api/social/blocks", { body: { handle: h } }); setBlocked((b) => (b ?? []).filter((x) => x.handle !== h)); }
    catch (x) { setErr(errMsg(x)); }
  }
  async function pickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setErr("");
    try { const url = await uploadImage(f); await api("/api/me/settings", { method: "PATCH", body: { avatarUrl: url } }); const m = await api("/api/me"); setMe(m.user); }
    catch (x) { setErr(errMsg(x)); }
  }
  async function runAvatar(url: string | null) {
    setErr("");
    try { await api("/api/me/settings", { method: "PATCH", body: { avatarUrl: url } }); const m = await api("/api/me"); setMe(m.user); }
    catch (x) { setErr(errMsg(x)); }
  }
  return (
    <div className="page narrow">
      <div className="card stack">
        <div className="row" style={{ alignItems: "center" }}>
          <Avatar handle={me?.handle ?? "?"} src={me?.avatarUrl} className="lg" round />
          <div>
            <b style={{ display: "block" }}>@{me?.handle ?? "…"}</b>
            <span className="muted small">Your PryingEyes account</span>
            <div style={{ marginTop: 6 }}>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
              <button type="button" className="btn sm ghost" onClick={() => fileRef.current?.click()}>{me?.avatarUrl ? "Change picture" : "Add picture"}</button>
              {me?.avatarUrl && <button type="button" className="btn sm ghost" onClick={() => runAvatar(null)}>Remove</button>}
            </div>
          </div>
        </div>
        <Link className="menu-row" href="/dashboard"><Icon name="shield" size={18} />My codes</Link>
        <Link className="menu-row" href="/settings"><Icon name="settings" size={18} />Settings</Link>
        <Link className="menu-row" href="/dashboard/audit"><Icon name="log" size={18} />Audit trail</Link>
        {moderator && <Link className="menu-row" href="/moderation"><Icon name="flag" size={18} />Moderation</Link>}
        {admin && <Link className="menu-row" href="/admin"><Icon name="sliders" size={18} />Admin</Link>}
        <button type="button" className="menu-row danger" onClick={signOut}><Icon name="logout" size={18} />Sign out</button>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ margin: "0 0 6px" }}>Blocked people</h2>
        <p className="muted small" style={{ margin: "0 0 10px" }}>People you&apos;ve blocked or reported. Unblocking restores their statuses and lets them interact with you again.</p>
        {err && <div className="alert err">{err}</div>}
        {blocked === null ? <p className="muted small">Loading…</p>
          : blocked.length === 0 ? <p className="muted small">You haven&apos;t blocked anyone.</p>
          : <div className="stack">{blocked.map((b) => (
              <div key={b.id} className="row" style={{ alignItems: "center" }}>
                <span className="avatar sm round">{b.handle[0].toUpperCase()}</span>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>@{b.handle}</span>
                <button className="btn sm ghost" onClick={() => unblock(b.handle)}>Unblock</button>
              </div>
            ))}</div>}
      </div>
    </div>
  );
}
