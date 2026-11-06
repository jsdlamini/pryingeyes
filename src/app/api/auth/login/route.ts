import { z } from "zod";
import { route, readJson, clientIp } from "@/lib/http";
import { passwordLogin } from "@/lib/accounts";
import { startSession } from "@/lib/login";

export const POST = route(async (req) => {
  const b = await readJson(req, z.object({ email: z.string().max(254), password: z.string().max(128) }));
  const r = await passwordLogin(b, clientIp(req));
  return startSession(req, r.userId, "password");
});
