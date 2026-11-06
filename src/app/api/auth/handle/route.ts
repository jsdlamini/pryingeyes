import { route, json, clientIp } from "@/lib/http";
import { handleSchema } from "@/lib/accounts";
import { isHandleTaken, suggestHandle } from "@/lib/handles";
import { hit } from "@/lib/ratelimit";
import { tooMany } from "@/lib/errors";

/**
 * GET /api/auth/handle            → { handle } a free, randomly generated handle
 * GET /api/auth/handle?check=abc  → { handle, valid, available, message? }
 */
export const GET = route(async (req) => {
  const b = await hit(`handle:ip:${clientIp(req)}`, 60, 60);
  if (!b.allowed) throw tooMany(b.retryAfter);
  const check = new URL(req.url).searchParams.get("check");
  if (check === null) return json({ handle: await suggestHandle() });
  const parsed = handleSchema.safeParse(check);
  if (!parsed.success) return json({ handle: check, valid: false, available: false, message: parsed.error.issues[0]?.message });
  return json({ handle: parsed.data, valid: true, available: !(await isHandleTaken(parsed.data)) });
});
