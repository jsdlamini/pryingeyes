import { route, json } from "@/lib/http";
import { publicKeyB64 } from "@/lib/evidence";

export const GET = route(async () => json({ algorithm: "Ed25519", format: "spki-der-base64", publicKey: publicKeyB64() }));
