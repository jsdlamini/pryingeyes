/**
 * Watermarked reveal (rule 8). The number is rasterised server-side and never sent as text.
 * The image carries the viewer's handle, the time and the token label repeated diagonally.
 */
import path from "node:path";
import fs from "node:fs";
import { and, eq, gt, isNull } from "drizzle-orm";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { decryptNumberFor } from "./vault";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

let fontReady = false;
function ensureFont() {
  if (fontReady) return;
  const p = path.join(process.cwd(), "assets", "fonts", "DejaVuSansMono-Bold.ttf");
  if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, "PEMono");
  fontReady = true;
}

function pretty(e164: string) {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

export function renderReveal(e164: string, watermark: { handle: string; at: Date; label: string }): Buffer {
  ensureFont();
  const W = 720, H = 300;
  const c = createCanvas(W, H);
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);

  // Diagonal watermark, repeated across the whole image
  const stamp = `@${watermark.handle} · ${watermark.at.toISOString().slice(0, 16).replace("T", " ")} UTC · ${watermark.label} · `;
  g.save();
  g.translate(W / 2, H / 2); g.rotate(-0.42); g.translate(-W, -H);
  g.font = "bold 17px PEMono, monospace"; g.fillStyle = "rgba(196, 111, 62, 0.28)";
  for (let y = 0; y < H * 2.2; y += 30) {
    const off = (y / 30) % 2 === 0 ? 0 : 120;
    g.fillText(stamp.repeat(6), -off, y);
  }
  g.restore();

  // The number
  g.font = "bold 52px PEMono, monospace"; g.fillStyle = "#1c2431"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(pretty(e164), W / 2, H / 2 - 8);
  // Footer
  g.font = "bold 15px PEMono, monospace"; g.fillStyle = "#5a6372";
  g.fillText(`Shown to @${watermark.handle} — logged and visible to the owner`, W / 2, H - 34);
  return c.toBuffer("image/png");
}

/** Consumes a one-time, 60-second grant and returns the PNG, or null. */
export async function consumeRevealGrant(callerId: string, handle: string, grantId: string): Promise<Buffer | null> {
  if (!/^[\w-]{20,64}$/.test(grantId)) return null;
  const [g] = await db().update(schema.revealGrants).set({ usedAt: new Date() })
    .where(and(eq(schema.revealGrants.id, grantId), eq(schema.revealGrants.callerId, callerId),
      isNull(schema.revealGrants.usedAt), gt(schema.revealGrants.expiresAt, new Date())))
    .returning();
  if (!g) return null;
  const rows = await db().select({ r: schema.decodeRequests, t: schema.tokens }).from(schema.decodeRequests)
    .innerJoin(schema.tokens, eq(schema.tokens.id, schema.decodeRequests.tokenId))
    .where(eq(schema.decodeRequests.id, g.requestId));
  const row = rows[0];
  if (!row || !["active", "consumed"].includes(row.t.status) || !row.t.numberId) return null; // revoked after grant, or app-only → nothing shown
  const e164 = await decryptNumberFor(row.t.numberId, "reveal");
  const png = renderReveal(e164, { handle, at: new Date(), label: row.t.label });
  await audit({ type: "reveal.viewed", actorId: callerId, ownerId: row.t.ownerId, subjectType: "request", subjectId: g.requestId });
  return png;
}
