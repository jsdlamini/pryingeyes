"use client";
import { useEffect, useRef, useState } from "react";

/** Record a voice note in the browser (MediaRecorder) and hand back the blob when stopped. */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [recTime, setRecTime] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!recording) { setRecTime(0); return; }
    const id = setInterval(() => setRecTime((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  async function start(): Promise<boolean> {
    setBlob(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recRef.current = rec; chunksRef.current = chunks;
      rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (chunks.length) setBlob(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      };
      rec.start();
      setRecording(true);
      return true;
    } catch {
      return false;
    }
  }

  function stop() { recRef.current?.stop(); }
  function reset() { setBlob(null); }

  return { recording, recTime, blob, start, stop, reset };
}
