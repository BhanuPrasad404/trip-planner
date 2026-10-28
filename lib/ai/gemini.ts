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

/** The smallest schema Gemini always accepts: types, properties, items, required, enum, description. Used when the full one is refused. */
const PLAIN_ALLOWED = new Set(["type", "description", "nullable", "enum", "items", "properties", "required"]);
export function toPlainGeminiSchema(node: unknown): unknown {
  const full = toGeminiSchema(node);
  const strip = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(strip);
    if (!n || typeof n !== "object") return n;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (!PLAIN_ALLOWED.has(k)) continue;
      out[k] = k === "properties" && v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, strip(pv)])) : k === "items" ? strip(v) : v;
    }
    return out;
  };
  return strip(full);
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

export function buildGeminiRequest(args: { system: string; content: ContentBlock[]; tool: ToolSpec; maxTokens: number; model?: string; thinking?: ThinkingMode; plain?: boolean }) {
  return {
    systemInstruction: { parts: [{ text: args.system }] },
    contents: [{ role: "user", parts: args.content.map(part) }],
    tools: [{ functionDeclarations: [{ name: args.tool.name, description: args.tool.description, parameters: args.plain ? toPlainGeminiSchema(args.tool.input_schema) : toGeminiSchema(args.tool.input_schema) }] }],
    // Force the model to answer through our one tool: structured output, never free text. (The plain request leaves the name list out.)
    toolConfig: { functionCallingConfig: args.plain ? { mode: "ANY" } : { mode: "ANY", allowedFunctionNames: [args.tool.name] } },
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

/**
 * Everything useful Google said about a refused request: the message, its status word (INVALID_ARGUMENT…) and the exact fields it
 * objected to (error.details[].fieldViolations). Safe to show: it never includes the key.
 */
export function providerDetail(body: string): string {
  try {
    const e = (JSON.parse(body) as { error?: { message?: string; status?: string; details?: { fieldViolations?: { field?: string; description?: string }[] }[] } }).error;
    if (!e) return "";
    const fields = (e.details ?? []).flatMap((d) => d.fieldViolations ?? []).map((v) => [v.field, v.description].filter(Boolean).join(": ")).filter(Boolean).slice(0, 3);
    return [e.status, (e.message ?? "").replace(/\s+/g, " "), ...fields].filter(Boolean).join(" · ").slice(0, 320);
  } catch {
    return "";
  }
}

/** Google's free tier is often busy (503) or briefly over its limit (429). Retrying and falling back hides most of that. */
export const GEMINI_FALLBACK_MODEL = "gemini-flash-lite-latest";
const RETRY_DELAYS_MS = [600];
const RETRY_SAME_MODEL = new Set([500, 503]);
/** 408 = this request hung until its own time limit: retrying the same model would only burn the wait, so the lighter model gets the next turn. */
export const TIMED_OUT = 408;
const TRY_OTHER_MODEL = new Set([400, 404, 408, 429, 500, 503, 504]); // 400 only reaches here after every way of asking was refused

/**
 * How long ONE request may take. Filling a form with thinking switched off answers in a few seconds; a request still silent after this is
 * stuck. It has to be well under the screen's total wait (22 s, lib/intake/ai-read.ts) so a second model still gets its turn inside it.
 */
export const ATTEMPT_TIMEOUT_MS = Math.max(3_000, Number(process.env.GEMINI_ATTEMPT_TIMEOUT_MS) || 9_000);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type AskArgs = Omit<Parameters<typeof buildGeminiRequest>[0], "model" | "thinking" | "plain"> & { signal?: AbortSignal };

/**
 * One way of asking. Google answers an unsupported setting with the bare words "Request contains an invalid argument." (no mention of
 * thinking), so we can't read the cause from the message: on ANY refused request (HTTP 400) the next rung is tried. The first four vary
 * only how the model is asked not to think; the last also sends the smallest schema Gemini accepts.
 */
export type Rung = { thinking: ThinkingMode; plain: boolean };
export const RUNGS: Rung[] = [...THINKING_CHAIN.map((thinking) => ({ thinking, plain: false })), { thinking: "none", plain: true }];
export const rungName = (r: Rung) => `${r.thinking}${r.plain ? "+plain" : ""}`;
const learnedRung = new Map<string, string>();

const isKeyProblem = (e: AiRequestError) => e.status === 401 || e.status === 403;

/** Run `attempt` down the rungs (starting at the one that worked last time) until one is accepted. Throws the last error with every attempt listed. */
export async function walkRungs<T>(model: string, attempt: (r: Rung) => Promise<T>, trail: string[] = []): Promise<T> {
  const remembered = RUNGS.findIndex((r) => rungName(r) === learnedRung.get(model));
  const first = remembered >= 0 ? remembered : Math.max(0, RUNGS.findIndex((r) => r.thinking === startThinking(model) && !r.plain));
  const order = [...RUNGS.slice(first), ...RUNGS.slice(0, first)];
  let last: AiRequestError | null = null;
  for (const rung of order) {
    try {
      const out = await attempt(rung);
      learnedRung.set(model, rungName(rung));
      return out;
    } catch (e) {
      if (!(e instanceof AiRequestError)) throw e;
      last = e;
      trail.push(`${model} (${rungName(rung)}): ${e.message}`);
      if (e.status !== 400 || isKeyProblem(e)) break; // only a refused request is worth another way of asking
    }
  }
  const err = last ?? new AiRequestError("AI request failed");
  err.detail = trail;
  throw err;
}

async function askOnce(model: string, apiKey: string, args: AskArgs, rung: Rung): Promise<unknown> {
  let res: Response;
  const started = Date.now();
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      // The key goes in a header, never in the URL (URLs end up in logs).
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildGeminiRequest({ system: args.system, content: args.content, tool: args.tool, maxTokens: args.maxTokens, model, thinking: rung.thinking, plain: rung.plain })),
      signal: args.signal ? AbortSignal.any([AbortSignal.timeout(ATTEMPT_TIMEOUT_MS), args.signal]) : AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
  } catch (err) {
    const waited = Date.now() - started;
    // Say WHY in the terminal (never the key): a hang, a stop because the screen gave up, or a network that cannot reach Google at all.
    if (err instanceof Error && err.name === "TimeoutError") {
      console.warn(`[ai] ${model}: no answer after ${waited} ms`);
      throw new AiRequestError(`AI request timed out after ${Math.round(waited / 1000)} s`, TIMED_OUT);
    }
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${(err.cause as NodeJS.ErrnoException).code ?? err.cause.message})` : "";
    console.warn(`[ai] ${model}: request failed after ${waited} ms: ${err instanceof Error ? err.name : "error"}${cause}`);
    throw new AiRequestError(`AI request failed: ${err instanceof Error ? err.message : "network error"}`, 503);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const said = providerDetail(body);
    console.error(`[ai] Gemini refused: HTTP ${res.status} model=${model} setting=${rungName(rung)}${said ? ` — ${said}` : ""}`);
    // Gemini reports a bad key as HTTP 400 "API key not valid"; treat it like a rejected key.
    const status = res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(body) ? 401 : res.status;
    throw new AiRequestError(`HTTP ${res.status}${said ? ` ${said}` : ""}`, status);
  }
  return parseGeminiResponse(await res.json(), args.tool.name);
}

/** Which models this key may really call, newest Flash first. Google's own list, so a retired or renamed model can never be the problem. */
export function pickModels(list: unknown): string[] {
  const models = ((list as { models?: { name?: string; supportedGenerationMethods?: string[] }[] } | null)?.models ?? [])
    .filter((m) => m.name && (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name!.replace(/^models\//, ""))
    .filter((n) => /^gemini-/.test(n) && !/image|tts|live|audio|embed|vision|robotics|computer|learnlm|customtools|thinking-exp/i.test(n));
  const stable = (n: string) => !/preview|exp/i.test(n);
  const version = (n: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1] ?? 0);
  const rank = (n: string) => (/flash/i.test(n) ? 2 : 0) + (/lite/i.test(n) ? -1 : 0) + (stable(n) ? 1 : 0);
  return [...new Set(models)].sort((a, b) => rank(b) - rank(a) || version(b) - version(a) || a.localeCompare(b));
}

let modelCache: { at: number; models: string[] } | null = null;
export async function listGeminiModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < 3_600_000) return modelCache.models;
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": apiKey }, signal: signal ? AbortSignal.any([AbortSignal.timeout(8_000), signal]) : AbortSignal.timeout(8_000) });
  if (!res.ok) throw new AiRequestError(`Could not list models: HTTP ${res.status}`, res.status);
  const models = pickModels(await res.json());
  modelCache = { at: Date.now(), models };
  return models;
}

export const callGemini: ToolCaller = async ({ system, content, tool, maxTokens = 1500, signal }) => {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new AiNotConfiguredError("GEMINI_API_KEY");
  const primary = (process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL).trim();
  const fallback = (process.env.GEMINI_FALLBACK_MODEL || GEMINI_FALLBACK_MODEL).trim();
  const args: AskArgs = { system, content, tool, maxTokens, signal };
  const trail: string[] = [];
  const tried = new Set<string>();

  const state: { last: AiRequestError | null } = { last: null };
  async function tryModel(model: string): Promise<{ done: true; out: unknown } | { done: false }> {
    tried.add(model);
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (signal?.aborted) throw state.last ?? new AiRequestError("AI request stopped: the wait was over", 503, trail);
      try {
        return { done: true, out: await walkRungs(model, (r) => askOnce(model, apiKey!, args, r), trail) };
      } catch (e) {
        if (!(e instanceof AiRequestError)) throw e;
        state.last = e;
        const status = e.status ?? 0;
        if (isKeyProblem(e)) { e.detail = trail; throw e; }                          // the key is wrong: no other model will help
        if (RETRY_SAME_MODEL.has(status) && attempt < RETRY_DELAYS_MS.length) { await sleep(RETRY_DELAYS_MS[attempt]); continue; } // busy: wait and retry
        return { done: false };                                                       // give this model up
      }
    }
    return { done: false };
  }

  for (const model of primary === fallback ? [primary] : [primary, fallback]) {
    const r = await tryModel(model);
    if (r.done) return r.out;
    if (state.last && !TRY_OTHER_MODEL.has(state.last.status ?? 0)) { state.last.detail = trail; throw state.last; }
  }
  // Both named models were refused or are gone: ask Google which models this key can use, and try the best one we haven't.
  if (state.last && (state.last.status === 400 || state.last.status === 404) && !signal?.aborted) {
    try {
      const candidates = (await listGeminiModels(apiKey, signal)).filter((m) => !tried.has(m)).slice(0, 2);
      for (const model of candidates) {
        const r = await tryModel(model);
        if (r.done) { console.warn(`[ai] ${primary} was refused; using ${model}. Set GEMINI_MODEL=${model} to skip the search.`); return r.out; }
      }
    } catch (e) {
      trail.push(`model list: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  const err = state.last ?? new AiRequestError("AI request failed");
  err.detail = trail;
  throw err;
};
