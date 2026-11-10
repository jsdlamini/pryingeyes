/** Plain names for the protection levels (the old "T1–T4" labels meant nothing to new users). */
export const TIER_NAMES: Record<number, string> = { 1: "Open", 2: "Checked", 3: "Ask me", 4: "Vault" };
export const TIER_LINES: Record<number, string> = {
  1: "Anyone with a verified account can message or call you in the app.",
  2: "They also confirm a code sent to their email, with a daily limit.",
  3: "You approve each person before they can reach you.",
  4: "Your number is shown only by you, once.",
};
export const Tier = ({ n }: { n: number }) => <span className={`tier t${n}`} title={TIER_LINES[n]}>{TIER_NAMES[n]}</span>;
export const Status = ({ s }: { s: string }) => <span className={`status ${s}`}>{s[0].toUpperCase() + s.slice(1)}</span>;
