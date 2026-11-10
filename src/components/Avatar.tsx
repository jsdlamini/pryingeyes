"use client";

/** Renders the user's profile picture when set, otherwise their initial. */
export function Avatar({ handle, src, className = "", round = true, alt }: { handle: string; src?: string | null; className?: string; round?: boolean; alt?: string }) {
  const cls = `${round ? "round" : ""} ${className}`.trim();
  if (src) return <img src={src} alt={alt ?? `@${handle}`} className={`avatar ${cls}`} style={{ objectFit: "cover" }} />;
  return <span className={`avatar ${cls}`} aria-hidden>{handle[0]?.toUpperCase() ?? "?"}</span>;
}
