import { route, NO_STORE } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { consumeRevealGrant } from "@/lib/reveal";
import { notFound } from "@/lib/errors";

/** One-time watermarked image. Never cached, never repeated. */
export const GET = route<{ grantId: string }>(async (req, { grantId }) => {
  const ctx = await requireUser(req);
  const png = await consumeRevealGrant(ctx.user.id, ctx.user.handle, grantId);
  if (!png) throw notFound("reveal_unavailable", "This view has expired.");
  return new Response(new Uint8Array(png), { status: 200, headers: {
    "Content-Type": "image/png", ...NO_STORE, "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline",
    "Referrer-Policy": "no-referrer",
  } });
});
