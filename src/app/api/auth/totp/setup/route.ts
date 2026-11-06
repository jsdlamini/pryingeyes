import QRCode from "qrcode";
import { route, json } from "@/lib/http";
import { requireUser, hasMfa, requireStepUp } from "@/lib/auth";
import { totpBegin } from "@/lib/accounts";

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  if (await hasMfa(ctx.user.id)) requireStepUp(ctx);
  const { secret, uri } = await totpBegin(ctx.user.id, ctx.user.handle);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  return json({ secret, uri, qr });
});
