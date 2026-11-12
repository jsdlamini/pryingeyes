import { z } from "zod";
import { route, json, readJson, clientIp } from "@/lib/http";
import { signupEmail } from "@/lib/accounts";
import { placesFromRequest } from "@/lib/places";

const Body = z.object({ email: z.string().max(254), password: z.string().max(128), handle: z.string().max(254).nullable().optional(), ageConfirmed: z.boolean(), next: z.string().max(200).nullable().optional() });

export const POST = route(async (req) => {
  const b = await readJson(req, Body);
  const places = placesFromRequest(req);
  return json(await signupEmail({ ...b, country: places.country, region: places.region }, clientIp(req)));
});
