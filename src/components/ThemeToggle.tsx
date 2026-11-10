"use client";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";

const KEY = "pe-theme";

function apply(theme: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
}

export function ThemeToggle({ label }: { label?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const cur = document.documentElement.getAttribute("data-theme");
    setTheme(cur === "dark" ? "dark" : "light");
  }, []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    apply(next);
  }
  return (
    <button type="button" className="iconbtn plain" onClick={toggle} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>
      <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
      {label ? <span className="nav-label">{label}</span> : null}
    </button>
  );
}
