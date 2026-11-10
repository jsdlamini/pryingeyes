"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { Icon, type IconName } from "./Icon";

type Item = { href: string; label: string; icon: IconName; match: (p: string) => boolean; badge?: "requests" | "chats" };

/** Codes first: the app is a privacy tool with a community attached, not the other way round. */
const ITEMS: Item[] = [
  { href: "/dashboard", label: "Codes", icon: "shield", match: (p) => p.startsWith("/dashboard") && !p.startsWith("/dashboard/requests") },
  { href: "/dashboard/requests", label: "Requests", icon: "inbox", match: (p) => p.startsWith("/dashboard/requests"), badge: "requests" },
  { href: "/chats", label: "Chats", icon: "chat", match: (p) => p.startsWith("/chats") || p.startsWith("/calls"), badge: "chats" },
  { href: "/groups", label: "Community", icon: "people", match: (p) => p.startsWith("/groups") || p.startsWith("/people") },
  { href: "/account", label: "Me", icon: "user", match: (p) => p.startsWith("/account") || p.startsWith("/settings") },
];

export function BottomNav() {
  const path = usePathname();
  const [counts, setCounts] = useState({ requests: 0, chats: 0 });
  const refresh = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    api("/api/notifications").then((r) => setCounts({ requests: r.requestsWaiting ?? 0, chats: r.chatsUnread ?? 0 })).catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", refresh); };
  }, [refresh, path]);

  return (
    <nav className="bottom-nav" aria-label="Main">
      {ITEMS.map((it) => {
        const n = it.badge ? counts[it.badge] : 0;
        return (
          <Link key={it.href} href={it.href} aria-current={it.match(path) ? "page" : undefined}>
            <span className="bn-icon">
              <Icon name={it.icon} size={22} />
              {n > 0 && <span className="bn-badge" aria-label={`${n} waiting`}>{n > 9 ? "9+" : n}</span>}
            </span>
            <span>{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
