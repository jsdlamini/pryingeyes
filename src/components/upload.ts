"use client";

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality);
  });
}

/** Convert any picked image to a resized WebP (handles iPhone HEIC + big photos), JPEG fallback. */
async function toImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    try {
      return await canvasToBlob(canvas, "image/webp", 0.82); // smaller + higher quality than JPEG
    } catch {
      return await canvasToBlob(canvas, "image/jpeg", 0.85);
    }
  } catch {
    return file; // fall back to the original file
  }
}

/** Upload an image and return its served URL. */
export async function uploadImage(file: File): Promise<string> {
  const blob = await toImage(file);
  const fd = new FormData();
  const name = blob.type === "image/webp" ? "photo.webp" : blob.type === "image/jpeg" ? "photo.jpg" : file.name;
  fd.append("file", blob, name);
  const r = await fetch("/api/upload", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || "Upload failed");
  return j.url as string;
}

/** Upload an audio blob (voice note) and return its served URL. */
export async function uploadAudio(blob: Blob): Promise<string> {
  const raw = (blob.type || "").split(";")[0].trim().toLowerCase();
  const type = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg"].includes(raw) ? raw : "audio/webm";
  const fixed = new Blob([blob], { type });
  const fd = new FormData();
  const name = type === "audio/mp4" ? "voice.m4a" : type === "audio/mpeg" ? "voice.mp3" : type === "audio/ogg" ? "voice.ogg" : "voice.webm";
  fd.append("file", fixed, name);
  const r = await fetch("/api/upload", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || "Upload failed");
  return j.url as string;
}

/** Upload a video (no re-encoding). */
export async function uploadVideo(file: File): Promise<string> {
  const raw = (file.type || "").split(";")[0].trim().toLowerCase();
  const type = ["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"].includes(raw) ? raw : "video/mp4";
  const fixed = new Blob([file], { type });
  const fd = new FormData();
  const name = type === "video/quicktime" ? "video.mov" : type === "video/x-m4v" ? "video.m4v" : type === "video/webm" ? "video.webm" : "video.mp4";
  fd.append("file", fixed, name);
  const r = await fetch("/api/upload", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || "Upload failed");
  return j.url as string;
}
