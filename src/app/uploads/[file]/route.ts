import { readFile } from "node:fs/promises";
import path from "node:path";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", webm: "audio/webm", m4a: "audio/mp4", mp3: "audio/mpeg", ogg: "audio/ogg", mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4" };

export const GET = async (_req: Request, { params }: { params: Promise<{ file: string }> }) => {
  const { file } = await params;
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif|webm|m4a|mp3|ogg|mp4|mov|m4v)$/.test(file)) return new Response("Not found", { status: 404 });
  const ext = file.split(".").pop()!;
  try {
    const buf = await readFile(path.join("/app/var", "uploads", file));
    return new Response(buf, {
      headers: {
        "Content-Type": TYPES[ext],
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};
