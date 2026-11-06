import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { createReport, REPORT_REASONS } from "@/lib/moderation";

const Body = z.object({
  conversationId: z.string().uuid().optional(), requestId: z.string().uuid().optional(),
  reason: z.enum(REPORT_REASONS), details: z.string().max(2000).optional(), messageIds: z.array(z.string().uuid()).max(20).optional(),
  block: z.boolean().optional(),
});

export const POST = route(async (req) => {
  const ctx = await requireUser(req);
  const b = await readJson(req, Body);
  const r = await createReport(ctx.user.id, b);
  if (b.block && b.conversationId) {
    const { blockInConversation } = await import("@/lib/chat");
    await blockInConversation(ctx.user.id, b.conversationId);
  }
  return json(r, 201);
});
