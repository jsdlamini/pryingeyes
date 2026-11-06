/**
 * Signed evidence packs (rule 11): a JSON document signed with Ed25519 plus a printable PDF
 * that carries the same events and the signature fingerprint. The JSON includes each event's
 * chain fields (prev_hash, payload_hash, hash) and the daily anchors, so the server's chain
 * can be checked against what was exported.
 */
import crypto from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db, schema } from "@/db";
import { audit, canonical } from "./audit";
import { env } from "./env";
import { ownerFeed } from "./feed";

function signingKey() {
  return crypto.createPrivateKey({ key: Buffer.from(env().EVIDENCE_SIGNING_KEY, "base64"), format: "der", type: "pkcs8" });
}
export function publicKeyB64() {
  return crypto.createPublicKey(signingKey()).export({ format: "der", type: "spki" }).toString("base64");
}

export async function buildEvidence(ownerId: string, range: { from?: Date; to?: Date } = {}) {
  const [u] = await db().select().from(schema.users).where(eq(schema.users.id, ownerId));
  const feed = await ownerFeed(ownerId, { limit: 5000, from: range.from, to: range.to });
  const seqs = feed.map((f) => f.seq);
  const chain = seqs.length
    ? (await db().select({ seq: schema.auditEvents.seq, prevHash: schema.auditEvents.prevHash, payloadHash: schema.auditEvents.payloadHash, hash: schema.auditEvents.hash })
        .from(schema.auditEvents).where(inArray(schema.auditEvents.seq, seqs)).orderBy(asc(schema.auditEvents.seq)))
    : [];
  const bySeq = new Map(chain.map((c) => [c.seq, c]));
  const anchors = await db().select().from(schema.auditAnchors).orderBy(asc(schema.auditAnchors.day));
  const body = {
    kind: "pryingeyes.evidence.v1",
    generatedAt: new Date().toISOString(),
    owner: `@${u.handle}`,
    range: { from: range.from?.toISOString() ?? null, to: range.to?.toISOString() ?? null },
    events: feed.slice().reverse().map((f) => ({
      seq: f.seq, at: new Date(f.at).toISOString(), type: f.type, description: f.text, by: f.actor, token: f.token,
      region: f.region, reason: f.reason, ...bySeq.get(f.seq),
    })),
    anchors: anchors.map((a) => ({ day: a.day, seq: a.seq, hash: a.hash })),
    publicKey: publicKeyB64(),
    note: "Verify: Ed25519 signature over the canonical JSON of this object without the 'signature' field, using 'publicKey' (SPKI DER, base64).",
  };
  const signature = crypto.sign(null, Buffer.from(canonical(body)), signingKey()).toString("base64");
  await audit({ type: "evidence.exported", actorId: ownerId, ownerId, payload: { events: body.events.length } });
  return { ...body, signature };
}

export function verifyEvidence(doc: Record<string, unknown>): boolean {
  const { signature, ...body } = doc as { signature: string } & Record<string, unknown>;
  try {
    const pub = crypto.createPublicKey({ key: Buffer.from(String(body.publicKey), "base64"), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(canonical(body)), pub, Buffer.from(signature, "base64"));
  } catch { return false; }
}

export async function evidencePdf(ev: Awaited<ReturnType<typeof buildEvidence>>): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`PryingEyes evidence pack — ${ev.owner}`);
  pdf.setProducer("PryingEyes"); pdf.setCreator("PryingEyes");
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const W = 595, H = 842, M = 48;
  let page = pdf.addPage([W, H]), y = H - M;
  const safe = (s: string) => s.replace(/[^\x20-\x7E]/g, "?");
  const line = (t: string, o: { size?: number; f?: typeof font; color?: [number, number, number]; x?: number } = {}) => {
    const size = o.size ?? 9;
    if (y < M + size) { page = pdf.addPage([W, H]); y = H - M; }
    page.drawText(safe(t), { x: o.x ?? M, y, size, font: o.f ?? font, color: rgb(...(o.color ?? [0.12, 0.15, 0.2])) });
    y -= size + 5;
  };
  line("PryingEyes - Evidence pack", { size: 18, f: bold });
  line(`Owner: ${ev.owner}    Generated: ${ev.generatedAt}`, { size: 10 });
  line(`Events: ${ev.events.length}    Range: ${ev.range.from ?? "start"} to ${ev.range.to ?? "now"}`, { size: 10 });
  y -= 6;
  line("Each row comes from PryingEyes' tamper-evident audit log. Phone numbers are never included.", { color: [0.35, 0.39, 0.45] });
  y -= 6;
  line("Time (UTC)            Event                                         Who             Token", { f: bold, size: 8.5 });
  for (const e of ev.events) {
    const who = e.by ? `@${e.by}` : "-";
    const what = `${e.description}${e.reason ? ` (${e.reason})` : ""}${e.region ? ` [${e.region}]` : ""}`;
    line(`${e.at.slice(0, 19).replace("T", " ")}   ${what.padEnd(45).slice(0, 45)} ${who.padEnd(15).slice(0, 15)} ${(e.token ?? "-").slice(0, 22)}`, { f: mono, size: 7.5 });
  }
  y -= 10;
  line("Integrity", { f: bold, size: 11 });
  const fp = crypto.createHash("sha256").update(ev.signature).digest("hex");
  line(`Signature fingerprint (SHA-256 of the Ed25519 signature): ${fp.slice(0, 32)}`, { size: 8 });
  line(`${fp.slice(32)}`, { size: 8, x: M + 236 });
  line("The matching signed JSON file can be verified with the published PryingEyes public key.", { size: 8 });
  return Buffer.from(await pdf.save());
}
