import { route, json, NO_STORE } from "@/lib/http";
import { requireCodeOwner } from "@/lib/auth";
import { buildEvidence, evidencePdf } from "@/lib/evidence";

/** Signed evidence pack: ?format=json (signed) or ?format=pdf (printable). Optional from/to (ISO dates). */
export const GET = route(async (req) => {
  const ctx = await requireCodeOwner(req);
  const u = new URL(req.url);
  const parse = (k: string) => { const v = u.searchParams.get(k); const d = v ? new Date(v) : undefined; return d && !isNaN(d.getTime()) ? d : undefined; };
  const ev = await buildEvidence(ctx.user.id, { from: parse("from"), to: parse("to") });
  const stamp = ev.generatedAt.slice(0, 10);
  if (u.searchParams.get("format") === "pdf") {
    const pdf = await evidencePdf(ev);
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", ...NO_STORE,
      "Content-Disposition": `attachment; filename="pryingeyes-evidence-${stamp}.pdf"` } });
  }
  return json(ev, 200, { "Content-Disposition": `attachment; filename="pryingeyes-evidence-${stamp}.json"` });
});
