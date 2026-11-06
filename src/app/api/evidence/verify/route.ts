import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { verifyEvidence, publicKeyB64 } from "@/lib/evidence";

/** Anyone (e.g. a platform or police officer) can check an evidence pack's signature. */
export const POST = route(async (req) => {
  const doc = await readJson(req, z.record(z.string(), z.unknown()));
  const valid = verifyEvidence(doc);
  return json({ valid, signedByThisServer: valid && doc.publicKey === publicKeyB64() });
});
