// The backup for voice input: record with the microphone ourselves and have the server turn it into words. Used when the browser's own
// speech recognition is missing or fails (Brave, Firefox, in-app browsers, no route to Google's speech service…).
import { MAX_RECORD_SECONDS, blobToWav, bytesToBase64 } from "./wav";

export type MicHandlers = { onTick: (seconds: number) => void; onDone: (blob: Blob) => void; onError: (message: string) => void; /** 0..1, about ten times a second while recording: shows the traveller the phone is really hearing them. */ onLevel?: (level: number) => void };

export function recorderSupported(): boolean {
  if (typeof window === "undefined") return false;
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext !== false;
}

/** A getUserMedia / MediaRecorder error → what to tell the traveller. */
export function micErrorMessage(name: string): string {
  switch (name) {
    case "NotAllowedError": case "SecurityError": return "The microphone is blocked for this site. Allow it in the browser's site settings, then try again, or type instead.";
    case "NotFoundError": case "OverconstrainedError": return "No microphone was found. Plug one in or check your phone's settings, or type instead.";
    case "NotReadableError": case "AbortError": return "The microphone is being used by another app. Close it and try again, or type instead.";
    default: return `The microphone didn't start (${name || "unknown"}). You can type instead.`;
  }
}

const FAILED = "We couldn't turn that into text this time. You can type instead.";
/** The server's answer → a sentence for the traveller, or null when the words arrived. */
export function transcribeMessage(status: string): string | null {
  switch (status) {
    case "ok": return null;
    case "empty": return "We didn't hear anything. Try again, a little closer to the phone.";
    case "off": return "Turning a recording into text isn't switched on here. You can type instead.";
    case "limit": return "Today's voice limit is used up. You can type instead, and try again tomorrow.";
    case "busy": return "The speech service is busy right now. Try again in a minute, or type instead.";
    case "bad_audio": return "That recording couldn't be read. Try once more, or type instead.";
    default: return FAILED;
  }
}

/** A rough 0..1 loudness from the analyser. Best effort: no AudioContext just means no meter, never a failed recording. */
function watchLevel(stream: MediaStream, onLevel: (v: number) => void): () => void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return () => undefined;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const b of data) peak = Math.max(peak, Math.abs(b - 128));
      onLevel(Math.min(1, peak / 64));
    }, 100);
    return () => { clearInterval(timer); void ctx.close().catch(() => undefined); };
  } catch { return () => undefined; }
}

export async function startRecording(h: MicHandlers): Promise<{ stop: () => void; /** Throw the recording away: nothing is sent or kept. */ cancel: () => void }> {
  const none = { stop: () => undefined, cancel: () => undefined };
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { h.onError(micErrorMessage(e instanceof DOMException ? e.name : "")); return none; }
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  let rec: MediaRecorder;
  try { rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 }); }
  catch (e) { stream.getTracks().forEach((t) => t.stop()); h.onError(micErrorMessage(e instanceof DOMException ? e.name : "")); return none; }
  const chunks: Blob[] = [];
  let seconds = 0, finished = false, cancelled = false;
  const stopMeter = h.onLevel ? watchLevel(stream, h.onLevel) : () => undefined;
  const cleanup = () => { clearInterval(tick); stopMeter(); stream.getTracks().forEach((t) => t.stop()); };
  const tick = setInterval(() => { seconds++; h.onTick(seconds); if (seconds >= MAX_RECORD_SECONDS) stop(); }, 1000);
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => { cleanup(); if (!finished) { finished = true; if (!cancelled) h.onDone(new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" })); } };
  rec.onerror = () => { cleanup(); if (!finished) { finished = true; h.onError("The recording stopped unexpectedly. You can type instead."); } };
  function stop() { if (rec.state !== "inactive") rec.stop(); }
  rec.start();
  return { stop, cancel: () => { cancelled = true; stop(); if (rec.state === "inactive") cleanup(); } };
}

/** Recording → words, through the server. Returns the text, or the sentence to show when it didn't work. */
export async function recordingToText(blob: Blob, lang: string): Promise<{ text: string } | { error: string }> {
  try {
    const wav = await blobToWav(blob);
    const r = await fetch("/api/intake/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: bytesToBase64(wav), lang }) });
    const j = (await r.json().catch(() => ({}))) as { status?: string; text?: string; error?: string };
    if (r.status === 429) return { error: "Slow down a little and try again in a minute." };
    if (!r.ok) return { error: j.error ?? FAILED };
    const msg = transcribeMessage(j.status ?? "failed");
    return msg === null ? { text: j.text ?? "" } : { error: msg };
  } catch {
    return { error: "No connection. Check the internet and try again, or type instead." };
  }
}
