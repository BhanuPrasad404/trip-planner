// The "Request contains an invalid argument." bug: Google's 400 for an unsupported setting does NOT say "thinking", so the old code
// (which only moved on when the word "thinking" appeared) gave up on the first try and the AI, the key test and voice Record all failed.
// Now ANY refused request tries the next way of asking, then a lighter model, then a model Google lists for the key.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGeminiRequest, callGemini, pickModels, providerDetail, toPlainGeminiSchema } from "@/lib/ai/gemini";
import { transcribeGemini } from "@/lib/ai/transcribe";
import { AiRequestError, type ToolSpec } from "@/lib/ai/types";

const tool: ToolSpec = {
  name: "report", description: "d",
  input_schema: { type: "object", properties: { when: { type: "string", format: "date" }, items: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", enum: ["a", "b"] } }, n: { type: ["integer", "null"], minimum: 1 } }, required: ["when"] },
};
const content = [{ type: "text" as const, text: "hi" }];
const OK = { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: "report", args: { done: true } } }] } }] }) } as unknown as Response;
const TEXT_OK = { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "hello there" }] } }] }) } as unknown as Response;
const generic400 = () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { code: 400, message: "Request contains an invalid argument.", status: "INVALID_ARGUMENT" } }) }) as unknown as Response;
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
const urlOf = (call: unknown[]) => String(call[0]);
const modelOf = (call: unknown[]) => (urlOf(call).includes("/models/") ? decodeURIComponent(urlOf(call).split("/models/")[1].split(":")[0]) : "(list)");

function setup(model: string, fallback = model) {
  vi.stubEnv("GEMINI_API_KEY", "AIzaTestKey1234567890"); vi.stubEnv("GEMINI_MODEL", model); vi.stubEnv("GEMINI_FALLBACK_MODEL", fallback);
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Gemini: a refused request tries another way of asking", () => {
  it("moves on after the generic 400 (no word 'thinking') and succeeds on the setting the model accepts", async () => {
    setup("gemini-flash-ladder-a");
    const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const cfg = JSON.parse(String(init?.body)).generationConfig.thinkingConfig;
      return cfg?.thinkingLevel === "low" ? OK : generic400();
    });
    vi.stubGlobal("fetch", f);
    expect(await callGemini({ system: "s", content, tool })).toEqual({ done: true });
    expect(f).toHaveBeenCalledTimes(3); // budget0 refused, minimal refused, low accepted
    await callGemini({ system: "s", content, tool });
    expect(f).toHaveBeenCalledTimes(4); // remembered: straight to "low"
    expect(bodyOf(f.mock.calls[3]).generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });

  it("falls to the plain request (smallest schema) when every thinking setting is refused", async () => {
    setup("gemini-flash-ladder-b");
    const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const fn = JSON.parse(String(init?.body)).tools[0].functionDeclarations[0].parameters;
      return JSON.stringify(fn).includes("minItems") || JSON.stringify(fn).includes('"format"') ? generic400() : OK;
    });
    vi.stubGlobal("fetch", f);
    expect(await callGemini({ system: "s", content, tool })).toEqual({ done: true });
    const last = bodyOf(f.mock.calls.at(-1)!);
    expect(last.generationConfig.thinkingConfig).toBeUndefined();
    expect(last.toolConfig.functionCallingConfig).toEqual({ mode: "ANY" });
  });

  it("when everything is refused the error lists each attempt and what Google said", async () => {
    setup("gemini-flash-ladder-c");
    vi.stubGlobal("fetch", vi.fn(async () => generic400()));
    const err = (await callGemini({ system: "s", content, tool }).catch((e: unknown) => e)) as AiRequestError;
    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.status).toBe(400);
    expect(err.detail.length).toBeGreaterThanOrEqual(5);
    expect(err.detail.join("\n")).toMatch(/budget0[\s\S]*INVALID_ARGUMENT[\s\S]*invalid argument/);
  });

  it("asks Google which models the key can use and succeeds with one of them", async () => {
    setup("gemini-gone-model", "gemini-gone-fallback");
    const f = vi.fn(async (u: unknown) => {
      if (/\/models\?pageSize/.test(String(u))) return { ok: true, status: 200, json: async () => ({ models: [{ name: "models/gemini-9-flash", supportedGenerationMethods: ["generateContent"] }] }) } as unknown as Response;
      return /gemini-9-flash/.test(String(u)) ? OK : generic400();
    });
    vi.stubGlobal("fetch", f);
    expect(await callGemini({ system: "s", content, tool })).toEqual({ done: true });
    expect(f.mock.calls.map(modelOf).includes("gemini-9-flash")).toBe(true);
  });

  it("a wrong key stops at once: nothing else is tried", async () => {
    setup("gemini-flash-ladder-d", "gemini-flash-ladder-d2");
    const f = vi.fn(async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: "API key not valid.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }) }) as unknown as Response);
    vi.stubGlobal("fetch", f);
    await expect(callGemini({ system: "s", content, tool })).rejects.toMatchObject({ status: 401 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a busy model (503) still goes to the lighter one, without walking the settings", async () => {
    setup("gemini-flash-ladder-e", "gemini-flash-lite-ladder-e");
    const f = vi.fn(async (u: unknown) => (/lite/.test(String(u)) ? OK : ({ ok: false, status: 503, text: async () => "{}" }) as unknown as Response));
    vi.stubGlobal("fetch", f);
    expect(await callGemini({ system: "s", content, tool })).toEqual({ done: true });
    expect(f.mock.calls.filter((c) => !/lite/.test(urlOf(c))).length).toBe(2); // one try + one retry, then the lighter model
  });
});

describe("Gemini: request shape and helpers", () => {
  it("the plain schema drops format, min/max and item limits but keeps types, enums and required", () => {
    const plain = toPlainGeminiSchema(tool.input_schema) as { properties: Record<string, Record<string, unknown>>; required: string[] };
    expect(JSON.stringify(plain)).not.toMatch(/format|minItems|maxItems|minimum/);
    expect(plain.properties.items.items).toEqual({ type: "STRING", enum: ["a", "b"] });
    expect(plain.properties.n).toEqual({ type: "INTEGER", nullable: true });
    expect(plain.required).toEqual(["when"]);
  });
  it("the full request keeps the tool-name list; the plain one leaves it out", () => {
    const base = { system: "s", content, tool, maxTokens: 100, model: "gemini-flash-x" };
    expect(buildGeminiRequest(base).toolConfig.functionCallingConfig).toEqual({ mode: "ANY", allowedFunctionNames: ["report"] });
    expect(buildGeminiRequest({ ...base, plain: true }).toolConfig.functionCallingConfig).toEqual({ mode: "ANY" });
  });
  it("providerDetail carries the status word and the exact fields Google objected to, never more than needed", () => {
    const body = JSON.stringify({ error: { message: "Invalid JSON payload", status: "INVALID_ARGUMENT", details: [{ fieldViolations: [{ field: "tools[0].parameters.format", description: "Unknown name" }] }] } });
    expect(providerDetail(body)).toBe("INVALID_ARGUMENT · Invalid JSON payload · tools[0].parameters.format: Unknown name");
    expect(providerDetail("not json")).toBe("");
  });
  it("pickModels keeps only text models the key can call, newest stable Flash first", () => {
    const m = (name: string, methods = ["generateContent"]) => ({ name: `models/${name}`, supportedGenerationMethods: methods });
    const out = pickModels({ models: [m("gemini-2.5-flash"), m("gemini-3-flash-preview"), m("gemini-3-flash"), m("gemini-2.5-flash-lite"), m("gemini-2.5-pro"), m("gemini-2.5-flash-image"), m("gemini-live-2.5-flash"), m("embedding-001", ["embedContent"]), m("gemini-2.5-flash-preview-tts")] });
    expect(out[0]).toBe("gemini-3-flash");
    expect(out).toContain("gemini-2.5-flash");
    expect(out.some((n) => /image|live|tts|embedding/.test(n))).toBe(false);
    expect(out.indexOf("gemini-2.5-flash-lite")).toBeGreaterThan(out.indexOf("gemini-2.5-flash"));
  });
});

describe("Voice Record uses the same recovery", () => {
  it("a generic 400 on the audio request tries the next setting, then returns the words", async () => {
    setup("gemini-flash-voice-a");
    const f = vi.fn(async (_u: unknown, init?: RequestInit) => (JSON.parse(String(init?.body)).generationConfig.thinkingConfig?.thinkingLevel === "minimal" ? TEXT_OK : generic400()));
    vi.stubGlobal("fetch", f);
    expect(await transcribeGemini({ wavBase64: "AAAA", languageName: "English" })).toBe("hello there");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("a lighter model is tried when the main one is gone (404)", async () => {
    setup("gemini-voice-gone", "gemini-voice-fallback");
    const f = vi.fn(async (u: unknown) => (/voice-fallback/.test(String(u)) ? TEXT_OK : ({ ok: false, status: 404, text: async () => JSON.stringify({ error: { message: "models/gemini-voice-gone is not found" } }) }) as unknown as Response));
    vi.stubGlobal("fetch", f);
    expect(await transcribeGemini({ wavBase64: "AAAA", languageName: "Telugu" })).toBe("hello there");
  });
  it("a rejected key is reported as a key problem", async () => {
    setup("gemini-flash-voice-b");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, text: async () => "{}" }) as unknown as Response));
    await expect(transcribeGemini({ wavBase64: "AAAA", languageName: "English" })).rejects.toMatchObject({ status: 403 });
  });
});
