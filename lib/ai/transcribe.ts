// Speech to text through Gemini, for the browsers whose own speech recognition fails or doesn't exist. The audio is a short WAV; the answer
// is plain words. (Gemini is the one provider wired for audio here: with another AI_PROVIDER voice falls back to the browser's own.)
import { geminiApiKey } from "@/lib/config";
import { AiNotConfiguredError, AiRequestError } from "./types";
import { GEMINI_DEFAULT_MODEL, GEMINI_FALLBACK_MODEL, THINKING_CHAIN, listGeminiModels, providerDetail, thinkingConfigFor, walkRungs } from "./gemini";

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

async function transcribeOnce(model: string, key: string, a: { wavBase64: string; languageName: string; signal?: AbortSignal }, thinking: (typeof THINKING_CHAIN)[number]): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(buildTranscribeRequest({ wavBase64: a.wavBase64, languageName: a.languageName, thinking })),
      signal: a.signal ? AbortSignal.any([AbortSignal.timeout(25_000), a.signal]) : AbortSignal.timeout(25_000),
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    console.warn(`[voice] ${model}: ${timedOut ? "no answer in 25 s" : "request failed"}`);
    throw new AiRequestError(`Transcription request failed: ${e instanceof Error ? e.message : "network error"}`, timedOut ? 408 : 503);
  }
  if (res.ok) return textOf(await res.json());
  const body = await res.text().catch(() => "");
  const said = providerDetail(body);
  console.error(`[voice] Gemini refused: HTTP ${res.status} model=${model} setting=${thinking}${said ? ` — ${said}` : ""}`);
  throw new AiRequestError(`HTTP ${res.status}${said ? ` ${said}` : ""}`, res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(body) ? 401 : res.status);
}

/** Speech to text. Like the form-filling call: any refused request tries another way of asking, then a lighter model, then whichever model the key can really use. */
export const transcribeGemini: Transcriber = async ({ wavBase64, languageName, signal }) => {
  const key = geminiApiKey();
  if (!key) throw new AiNotConfiguredError("GEMINI_API_KEY");
  const primary = (process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL).trim();
  const fallback = (process.env.GEMINI_FALLBACK_MODEL || GEMINI_FALLBACK_MODEL).trim();
  const trail: string[] = [];
  const tried = new Set<string>();
  let last: AiRequestError | null = null;
  const run = async (model: string): Promise<string | null> => {
    tried.add(model);
    try {
      return await walkRungs(model, (r) => transcribeOnce(model, key, { wavBase64, languageName, signal }, r.thinking), trail);
    } catch (e) {
      if (!(e instanceof AiRequestError)) throw e;
      last = e;
      if (e.status === 401 || e.status === 403) throw e;
      return null;
    }
  };
  for (const model of primary === fallback ? [primary] : [primary, fallback]) {
    const out = await run(model);
    if (out !== null) return out;
    if (signal?.aborted) break;
  }
  const failure = last as AiRequestError | null;
  if (failure && (failure.status === 400 || failure.status === 404) && !signal?.aborted) {
    try {
      for (const model of (await listGeminiModels(key, signal)).filter((m) => !tried.has(m)).slice(0, 2)) {
        const out = await run(model);
        if (out !== null) return out;
      }
    } catch { /* the list is only a help */ }
  }
  const err = (last as AiRequestError | null) ?? new AiRequestError("Transcription failed");
  err.detail = trail;
  throw err;
};
