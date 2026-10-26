// Speech to text through Gemini, for the browsers whose own speech recognition fails or doesn't exist. The audio is a short WAV; the answer
// is plain words. (Gemini is the one provider wired for audio here: with another AI_PROVIDER voice falls back to the browser's own.)
import { geminiApiKey } from "@/lib/config";
import { AiNotConfiguredError, AiRequestError } from "./types";
import { GEMINI_DEFAULT_MODEL, THINKING_CHAIN, startThinking, thinkingConfigFor, providerMessage } from "./gemini";

export type Transcriber = (a: { wavBase64: string; languageName: string; signal?: AbortSignal }) => Promise<string>;

const prompt = (lang: string) => `Transcribe the speech in this audio exactly as spoken. The speaker uses ${lang}, possibly mixed with English. Write each language in its own usual script (for example Telugu in Telugu script). Return ONLY the words spoken: no quotes, no labels, no translation, no comment. If there is no speech, return nothing.`;

export function buildTranscribeRequest(a: { wavBase64: string; languageName: string; thinking: (typeof THINKING_CHAIN)[number] }) {
  const cfg = thinkingConfigFor(a.thinking);
  return {
    contents: [{ role: "user", parts: [{ text: prompt(a.languageName) }, { inline_data: { mime_type: "audio/wav", data: a.wavBase64 } }] }],
    generationConfig: { maxOutputTokens: cfg ? 2048 : 8192, temperature: 0, ...(cfg ? { thinkingConfig: cfg } : {}) },
  };
}

export const textOf = (json: unknown): string =>
  ((json as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null)?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();

export const transcribeGemini: Transcriber = async ({ wavBase64, languageName, signal }) => {
  const key = geminiApiKey();
  if (!key) throw new AiNotConfiguredError("GEMINI_API_KEY");
  const model = (process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL).trim();
  let i = THINKING_CHAIN.indexOf(startThinking(model));
  for (;;) {
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(buildTranscribeRequest({ wavBase64, languageName, thinking: THINKING_CHAIN[i] })),
        signal: signal ? AbortSignal.any([AbortSignal.timeout(25_000), signal]) : AbortSignal.timeout(25_000),
      });
    } catch (e) { throw new AiRequestError(`Transcription request failed: ${e instanceof Error ? e.message : "network error"}`, 503); }
    if (res.ok) return textOf(await res.json());
    const body = await res.text().catch(() => "");
    if (res.status === 400 && /thinking/i.test(providerMessage(body)) && i < THINKING_CHAIN.length - 1) { i++; continue; }
    throw new AiRequestError(`Transcription service returned ${res.status}`, res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(body) ? 401 : res.status);
  }
};
