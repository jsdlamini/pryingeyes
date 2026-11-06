import { route, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { iceConfigFor } from "@/lib/calls";
import { hit } from "@/lib/ratelimit";
import { tooMany } from "@/lib/errors";

/** Short-lived TURN credentials for this user (coturn validates them with the shared secret). */
export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  const b = await hit(`call:ice:${ctx.user.id}`, 60, 3600);
  if (!b.allowed) throw tooMany(b.retryAfter);
  const { iceServers, relayOnly, ttlSec, configured } = iceConfigFor(ctx.user.id);
  return json({ iceServers, iceTransportPolicy: relayOnly ? "relay" : "all", ttlSec, configured });
});
