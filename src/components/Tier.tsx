const NAMES: Record<number, string> = { 1: "Open", 2: "Gated", 3: "Consent", 4: "Vault" };
export const Tier = ({ n }: { n: number }) => <span className={`tier t${n}`}>T{n} {NAMES[n]}</span>;
export const Status = ({ s }: { s: string }) => <span className={`status ${s}`}>{s[0].toUpperCase() + s.slice(1)}</span>;
