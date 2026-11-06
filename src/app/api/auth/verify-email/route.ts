import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { verifyEmailToken } from "@/lib/accounts";

export const POST = route(async (req) => {
  const { token } = await readJson(req, z.object({ token: z.string().min(10).max(128) }));
  await verifyEmailToken(token);
  return json({ status: "verified" });
});
