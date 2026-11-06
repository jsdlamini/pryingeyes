import { z } from "zod";
import { route, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { callOptionFor, chatPartnerHandle, listMessages, sendMessage } from "@/lib/chat";
import { mintShareCode } from "@/lib/social";
import { AttachBody, authorFor } from "@/lib/social-http";

export const GET = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireUser(req);
  const after = new URL(req.url).searchParams.get("after");
  const d = after ? new Date(after) : undefined;
  const data = await listMessages(ctx.user.id, id, d && !isNaN(d.getTime()) ? d : undefined);
  return json({ ...data, call: await callOptionFor(ctx.user.id, id) });
});

/**
 * Sends a message. With `attach`, a fresh contact code of the sender's is added to it (labelled with
 * who it was shared with). Both apps show any code link in a message as a tappable code.
 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const b = await readJson(req, z.object({ text: z.string().max(4000).default(""), attach: AttachBody }));
  const ctx = await authorFor(req, b.attach);
  let text = b.text;
  if (b.attach) {
    const who = await chatPartnerHandle(ctx.user.id, id);      // also checks they're in this chat
    const code = await mintShareCode(ctx.user.id, `Shared with @${who}`, b.attach);
    text = `${text.trim()}\n${code.link}`.trim();
  }
  return json(await sendMessage(ctx.user.id, id, text), 201);
});
