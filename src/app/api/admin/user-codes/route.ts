import { route, json } from "@/lib/http";
import { requireUser, requireRole } from "@/lib/auth";
import { listUserTokens } from "@/lib/admin";
import { badRequest } from "@/lib/errors";

export const GET = route(async (req) => {
  const ctx = await requireUser(req);
  requireRole(ctx, "admin");
  const handle = new URL(req.url).searchParams.get("handle")?.trim() ?? "";
  if (!handle) throw badRequest("handle_required", "Enter a handle.");
  return json(await listUserTokens(handle));
});
