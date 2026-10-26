// Google Gemini adapter (REST, no SDK). Free to try with a key from https://aistudio.google.com/app/apikey (rate-limited).
// NOTE for production: Google may use free-tier requests to improve its products — do not send private data on the free tier.
import { geminiApiKey } from "@/lib/config";
import { AiNotConfiguredError, AiRequestError, type ContentBlock, type ToolCaller, type ToolSpec } from "./types";

/**
 * "-latest" always points at Google's current Flash model, so a retired version (2.5 Flash stopped being offered to new
 * accounts) never breaks the app. Pin an exact model with GEMINI_MODEL if you need repeatable behaviour.
 */
export const GEMINI_DEFAULT_MODEL = "gemini-flash-latest";

const ALLOWED = new Set(["type", "format", "description", "nullable", "enum", "items", "properties", "required", "minItems", "maxItems", "minimum", "maximum"]);

/** Gemini accepts only a subset of JSON Schema (OpenAPI style, upper-case types). Convert ours, dropping what it rejects. */
export function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (!ALLOWED.has(k)) continue; // additionalProperties, $schema, default, … are not accepted
    if (k === "type") {
      const types = (Array.isArray(v) ? v : [v]).filter((t) => t !== "null");
      if (Array.isArray(v) && v.includes("null")) out.nullable = true;
      out.type = String(types[0] ?? "string").toUpperCase();
    } else if (k === "properties" && v && typeof v === "object") {
      out.properties = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
    } else if (k === "items") {
      out.items = toGeminiSchema(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const part = (b: ContentBlock) => (b.type === "text" ? { text: b.text } : { inline_data: { mime_type: b.source.media_type, data: b.source.data } });

/**
 * Gemini 2.5 Flash "thinks" before answering, and thinking tokens are counted INSIDE maxOutputTokens. With a small limit the
 * model can use it all up thinking and return nothing. We only need to extract/fill a form, so thinking is switched off for
 * the Flash models (that is allowed for them), and the limit never goes below 2048.
 */
export const thinkingOffFor = (model: string) => /gemini-2\.5-flash/.test(model);

/**
 * How to ask the model NOT to think (a form fill needs no reasoning, and thinking is what makes the call slow). Models differ and the
 * "-latest" names move, so we try the ways in turn and remember the one the model accepts:
 *   budget0 (2.5 Flash family) → minimal / low (Gemini 3 "thinking level") → none (models that always think, e.g. Pro).
 * A model that rejects a setting answers HTTP 400 with the word "thinking" in the message: that is the cue to try the next one.
 */
export type ThinkingMode = "budget0" | "minimal" | "low" | "none";
export const THINKING_CHAIN: ThinkingMode[] = ["budget0", "minimal", "low", "none"];
export const thinkingConfigFor = (m: ThinkingMode): Record<string, unknown> | null => (m === "budget0" ? { thinkingBudget: 0 } : m === "minimal" ? { thinkingLevel: "minimal" } : m === "low" ? { thinkingLevel: "low" } : null);
/** First setting to try for a model: every Flash model is a form-filler candidate; others (Pro) always think. */
export const startThinking = (model: string): ThinkingMode => (/flash/i.test(model) ? "budget0" : "none");
const learnedThinking = new Map<string, ThinkingMode>();

export function buildGeminiRequest(args: { system: string; content: ContentBlock[]; tool: ToolSpec; maxTokens: number; model?: string; thinking?: ThinkingMode }) {
  return {
    systemInstruction: { parts: [{ text: args.system }] },
    contents: [{ role: "user", parts: args.content.map(part) }],
    tools: [{ functionDeclarations: [{ name: args.tool.name, description: args.tool.description, parameters: toGeminiSchema(args.tool.input_schema) }] }],
    // Force the model to answer through our one tool: structured output, never free text.
    toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [args.tool.name] } },
    generationConfig: (() => {
      if (args.thinking) {
        const cfg = thinkingConfigFor(args.thinking);
        return { maxOutputTokens: Math.max(args.maxTokens, cfg ? 2048 : 8192), temperature: 0, ...(cfg ? { thinkingConfig: cfg } : {}) };
      }
      const off = thinkingOffFor(args.model ?? GEMINI_DEFAULT_MODEL);
      // Where thinking cannot be switched off (newer/Pro models) it shares this limit, so leave plenty of room for the answer.
      return { maxOutputTokens: Math.max(args.maxTokens, off ? 2048 : 8192), temperature: 0, ...(off ? { thinkingConfig: { thinkingBudget: 0 } } : {}) };
    })(),
  };
}

type GeminiResponse = { candidates?: { finishReason?: string; content?: { parts?: { functionCall?: { name?: string; args?: unknown } }[] } }[]; promptFeedback?: { blockReason?: string } };

export function parseGeminiResponse(json: unknown, toolName: string): unknown {
  const parts = (json as GeminiResponse | null)?.candidates?.[0]?.content?.parts ?? [];
  const call = parts.find((p) => p.functionCall?.name === toolName)?.functionCall;
  if (!call) {
    // Say WHY nothing came back (ran out of tokens, blocked, …) so it can be fixed instead of guessed at.
    const r = json as GeminiResponse | null;
    const why = r?.promptFeedback?.blockReason ? `blocked: ${r.promptFeedback.blockReason}` : r?.candidates?.[0]?.finishReason ? `finishReason: ${r.candidates[0].finishReason}` : "empty answer";
    throw new AiRequestError(`AI returned no structured result (${why})`);
  }
  return call.args ?? {};
}

/** Google's own error text, e.g. "models/xyz is not found for API version v1beta". Safe to show: it never includes the key. */
export function providerMessage(body: string): string {
  try {
    const m = (JSON.parse(body) as { error?: { message?: string } }).error?.message;
    return (m ?? "").replace(/\s+/g, " ").slice(0, 220);
  } catch {
    return "";
  }
}

/** Google's free tier is often busy (503) or briefly over its limit (429). Retrying and falling back hides most of that. */
export const GEMINI_FALLBACK_MODEL = "gemini-flash-lite-latest";
const RETRY_DELAYS_MS = [800, 2_000];
const RETRY_SAME_MODEL = new Set([500, 503, 504]);
const TRY_OTHER_MODEL = new Set([404, 429, 500, 503, 504]);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type AskArgs = Omit<Parameters<typeof buildGeminiRequest>[0], "model" | "thinking"> & { signal?: AbortSignal };

async function askOnce(model: string, apiKey: string, args: AskArgs, thinking: ThinkingMode): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      // The key goes in a header, never in the URL (URLs end up in logs).
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildGeminiRequest({ system: args.system, content: args.content, tool: args.tool, maxTokens: args.maxTokens, model, thinking })),
      signal: args.signal ? AbortSignal.any([AbortSignal.timeout(30_000), args.signal]) : AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new AiRequestError(`AI request failed: ${err instanceof Error ? err.message : "network error"}`, 503);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[ai] Gemini error status", res.status, model);
    // Gemini reports a bad key as HTTP 400 "API key not valid"; treat it like a rejected key.
    const status = res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(body) ? 401 : res.status;
    throw new AiRequestError(`AI service returned ${res.status}${providerMessage(body) ? `: ${providerMessage(body)}` : ""}`, status);
  }
  return parseGeminiResponse(await res.json(), args.tool.name);
}

/** One request, trying the "don't think" settings in turn when the model rejects one (HTTP 400 mentioning thinking). */
async function askWithThinking(model: string, apiKey: string, args: AskArgs): Promise<unknown> {
  let i = Math.max(0, THINKING_CHAIN.indexOf(learnedThinking.get(model) ?? startThinking(model)));
  for (;;) {
    try {
      const out = await askOnce(model, apiKey, args, THINKING_CHAIN[i]);
      learnedThinking.set(model, THINKING_CHAIN[i]);
      return out;
    } catch (e) {
      if (e instanceof AiRequestError && e.status === 400 && /thinking/i.test(e.message) && i < THINKING_CHAIN.length - 1) { i++; continue; }
      throw e;
    }
  }
}

export const callGemini: ToolCaller = async ({ system, content, tool, maxTokens = 1500, signal }) => {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new AiNotConfiguredError("GEMINI_API_KEY");
  const primary = (process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL).trim();
  const fallback = (process.env.GEMINI_FALLBACK_MODEL || GEMINI_FALLBACK_MODEL).trim();
  const args: AskArgs = { system, content, tool, maxTokens, signal };

  let last: AiRequestError | null = null;
  for (const model of primary === fallback ? [primary] : [primary, fallback]) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (signal?.aborted) throw last ?? new AiRequestError("AI request stopped: the wait was over", 503);
      try {
        return await askWithThinking(model, apiKey, args);
      } catch (e) {
        if (!(e instanceof AiRequestError)) throw e;
        last = e;
        const status = e.status ?? 0;
        if (status === 401 || status === 403 || status === 400) throw e;           // the key or the request is wrong: retrying won't help
        if (RETRY_SAME_MODEL.has(status) && attempt < RETRY_DELAYS_MS.length) { await sleep(RETRY_DELAYS_MS[attempt]); continue; } // busy: wait and retry
        break;                                                                      // give this model up…
      }
    }
    if (last && !TRY_OTHER_MODEL.has(last.status ?? 0)) throw last;                 // …and try the lighter one only for busy / limit / gone
  }
  throw last ?? new AiRequestError("AI request failed");
};
