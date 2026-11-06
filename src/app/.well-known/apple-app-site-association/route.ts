import { env } from "@/lib/env";

/** iOS Universal Links: lets the app open https://<host>/t/… and /g/… links directly. */
export const dynamic = "force-dynamic";
export function GET() {
  const team = env().IOS_TEAM_ID.trim();
  const body = { applinks: { details: team ? [{ appIDs: [`${team}.${env().IOS_BUNDLE_ID}`], components: [{ "/": "/t/*" }, { "/": "/g/*" }] }] : [] } };
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } });
}
