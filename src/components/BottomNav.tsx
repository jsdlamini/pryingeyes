"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";

const ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: "/groups", label: "Feed", icon: "home" },
  { href: "/people", label: "People", icon: "people" },
  { href: "/chats", label: "Chats", icon: "chat" },
  { href: "/account", label: "Profile", icon: "user" },
];

export function BottomNav() {
  const path = usePathname();
  const current = (href: string) => path === href || (href !== "/groups" && path.startsWith(href));
  return (
    <nav className="bottom-nav" aria-label="Main">
      {ITEMS.map((it) => (
        <Link key={it.href} href={it.href} aria-current={current(it.href) ? "page" : undefined}>
          <Icon name={it.icon} size={22} />
          <span>{it.label}</span>
        </Link>
      ))}
    </nav>
  );
}
