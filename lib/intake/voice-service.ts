// "Say it instead" when the browser's own speech recognition can't: a short recording is turned into words on the server.
// Plain function with its outside services injected (the route passes the real ones, tests pass fakes).
import { z } from "zod";
import { AiNotConfiguredError, AiRequestError } from "@/lib/ai/types";
import type { Transcriber } from "@/lib/ai/transcribe";
import { MAX_RECORD_SECONDS, readWavHeader } from "@/lib/client/wav";

export const VOICE_LANGUAGE_NAME = { "en-IN": "English", "te-IN": "Telugu", "hi-IN": "Hindi", "ta-IN": "Tamil", "kn-IN": "Kannada", "mr-IN": "Marathi" } as const;
export type VoiceLang = keyof typeof VOICE_LANGUAGE_NAME;

/** 45 s of 16 kHz 16-bit mono is about 1.4 MB; as base64 about 1.9 MB. A little room above that, nothing more. */
export const MAX_AUDIO_BASE64_CHARS = 2_100_000;
export const intakeVoiceSchema = z.object({
  audio: z.string().min(100, "The recording was empty").max(MAX_AUDIO_BASE64_CHARS, "That recording is too long"),
  lang: z.enum(Object.keys(VOICE_LANGUAGE_NAME) as [VoiceLang, ...VoiceLang[]]),
});

/** ok · empty (nothing heard) · bad_audio (not a recording we can use) · limit (our daily limit) · off (no speech service here) · busy · failed. */
export type VoiceStatus = "ok" | "empty" | "bad_audio" | "limit" | "off" | "busy" | "failed";
export type VoiceAnswer = { status: VoiceStatus; text: string };

const clean = (t: string) => t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\s+\n/g, "\n").trim().slice(0, 4000);

export async function transcribeVoice(input: { audio: string; lang: VoiceLang }, deps: { transcribe: Transcriber; allow: () => Promise<boolean>; available: boolean; signal?: AbortSignal }): Promise<VoiceAnswer> {
  const none = (status: VoiceStatus): VoiceAnswer => ({ status, text: "" });
  if (!deps.available) return none("off");
  // Only the plain WAV our own page writes: nothing else is passed on to the speech service.
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(Buffer.from(input.audio, "base64")); } catch { return none("bad_audio"); }
  const h = readWavHeader(bytes);
  if (!h || h.bits !== 16 || h.channels < 1 || h.channels > 2 || h.sampleRate < 8_000 || h.sampleRate > 48_000 || h.dataBytes <= 0 || h.dataBytes > bytes.length - 44) return none("bad_audio");
  if (h.seconds > MAX_RECORD_SECONDS + 2) return none("bad_audio");
  if (h.seconds < 0.3) return none("empty");
  if (!(await deps.allow())) return none("limit");
  try {
    const text = clean(await deps.transcribe({ wavBase64: input.audio, languageName: VOICE_LANGUAGE_NAME[input.lang], signal: deps.signal }));
    return text ? { status: "ok", text } : none("empty");
  } catch (e) {
    if (e instanceof AiNotConfiguredError) return none("off");
    if (e instanceof AiRequestError && (e.status === 429 || e.status === 503)) return none("busy");
    return none("failed");
  }
}
