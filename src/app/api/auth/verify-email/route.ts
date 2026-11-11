import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { verifyEmailToken } from "@/lib/accounts";

export const POST = route(async (req) => {
  const { token, next } = await readJson(req, z.object({ token: z.string().min(10).max(128), next: z.string().max(200).nullable().optional() }));
  await verifyEmailToken(token, next);
  return json({ status: "verified" });
});
