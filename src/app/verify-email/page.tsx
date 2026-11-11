"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, errMsg } from "@/components/api";

export default function VerifyEmail() {
  const [state, setState] = useState<"working" | "ok" | "err">("working");
  const [msg, setMsg] = useState("");
  const [next, setNext] = useState("/dashboard");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const token = q.get("token") ?? "";
    // Back to whatever they were opening when they signed up (a contact code or a group invite).
    const n = q.get("next");
    if (n && /^\/(?!\/)/.test(n)) setNext(n);
    api("/api/auth/verify-email", { body: { token, next } }).then(() => setState("ok")).catch((e) => { setMsg(errMsg(e)); setState("err"); });
  }, []);
  return (
    <div className="narrow">
      <div className="card" role="status">
        {state === "working" && <p>Confirming your email…</p>}
        {state === "ok" && <><h1>Email confirmed</h1><p>{next.startsWith("/t/") ? "Sign in to continue to the person you were reaching." : next.startsWith("/g/") ? "Sign in to join the group." : "Sign in to create your first code."}</p><Link className="btn" href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></>}
        {state === "err" && <><h1>That link didn't work</h1><p>{msg}</p><Link className="btn ghost" href="/signup">Start again</Link></>}
      </div>
    </div>
  );
}
