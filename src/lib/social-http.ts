import { z } from "zod";
import { requireCodeOwner, requireOwner, requireUser } from "./auth";
import { notFound } from "./errors";

export const uuid = (id: string) => { if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound(); return id; };
export const AttachBody = z.object({ numberId: z.string().uuid().nullable().optional(), tier: z.union([z.literal(1), z.literal(2), z.literal(3)]), kind: z.enum(["standard", "day", "one"]).optional() }).nullable().optional();
export const PostBody = z.object({ text: z.string().max(4000).default(""), attach: AttachBody });

/** Attaching an app-only code needs only an 18+ account; a code backed by a phone number needs two-step sign-in. */
export const authorFor = (req: Request, attach: { numberId?: string | null } | null | undefined) =>
  (!attach ? requireUser(req) : attach.numberId ? requireOwner(req) : requireCodeOwner(req));
