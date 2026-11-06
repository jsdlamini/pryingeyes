/** Development helper: prints the current 6-digit code for an authenticator key (e.g. from the seed). */
import { totpAt } from "@/lib/totp";
const key = process.argv[2];
if (!key) { console.error("Usage: npm run dev:totp -- <authenticator key>"); process.exit(1); }
const secs = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`${totpAt(key)}  (valid ~${secs}s; next: ${totpAt(key, Date.now() + 30000)})`);
