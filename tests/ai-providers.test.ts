import { afterEach, describe, expect, it, vi } from "vitest";
import { aiProviderId, diagnoseAi } from "@/lib/config";
import { buildGeminiRequest, callGemini, parseGeminiResponse, toGeminiSchema, GEMINI_DEFAULT_MODEL } from "@/lib/ai/gemini";
import { buildChatRequest, callOpenAiCompatible, parseChatResponse } from "@/lib/ai/openai-compatible";
import { AiNotConfiguredError, AiRequestError, type ToolSpec } from "@/lib/ai/types";

const tool: ToolSpec = {
  name: "report_places", description: "Report places",
  input_schema: { type: "object", additionalProperties: false, properties: { places: { type: "array", maxItems: 12, items: { type: "object", properties: { name: { type: "string" }, kind: { type: "string", enum: ["fort", "lake"] }, area: { type: ["string", "null"] } }, required: ["name"] } } }, required: ["places"] },
};
const content = [{ type: "text" as const, text: "Visit Kondapalli Fort" }, { type: "image" as const, source: { type: "base64" as const, media_type: "image/png", data: "QUJD" } }];

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("which AI provider is used", () => {
  it("honours AI_PROVIDER, otherwise the first key that is present", () => {
    expect(aiProviderId({})).toBe("anthropic");                                      // nothing set: the default (reported as 'not set up')
    expect(aiProviderId({ GEMINI_API_KEY: "AIzaX" })).toBe("gemini");
    expect(aiProviderId({ OPENAI_API_KEY: "k" })).toBe("openai");
    expect(aiProviderId({ ANTHROPIC_API_KEY: "sk-ant-x", GEMINI_API_KEY: "AIzaX" })).toBe("anthropic");
    expect(aiProviderId({ ANTHROPIC_API_KEY: "sk-ant-x", GEMINI_API_KEY: "AIzaX", AI_PROVIDER: "gemini" })).toBe("gemini");
    expect(aiProviderId({ AI_PROVIDER: "nonsense", GEMINI_API_KEY: "AIzaX" })).toBe("gemini");
  });
  it("tells the traveller what is missing for the chosen provider — and offers Gemini when Anthropic has no key", () => {
    expect(diagnoseAi({ GEMINI_API_KEY: "AIzaSyExample" }).ok).toBe(true);
    expect(diagnoseAi({ GEMINI_API_KEY: "oops" }).problem).toMatch(/too short/);
    expect(diagnoseAi({ GEMINI_API_KEY: "AQ.Ab8RN6Iexamplekeyexamplekeyexample" }).problem).toBeNull(); // a different-looking real key is not second-guessed
    const none = diagnoseAi({}, { present: [], misnamed: [], hasKeyLine: false } as never, false);
    expect(none.ok).toBe(false);
    expect(none.fix).toMatch(/GEMINI_API_KEY/);
    expect(diagnoseAi({ AI_PROVIDER: "gemini" }).fix).toMatch(/aistudio\.google\.com/);
    expect(diagnoseAi({ AI_PROVIDER: "openai" }).problem).toMatch(/OPENAI_API_KEY/);
  });
});

describe("Gemini adapter", () => {
  it("converts our schema to Gemini's subset: upper-case types, nullable, no unsupported keys", () => {
    const s = toGeminiSchema(tool.input_schema) as { type: string; properties: { places: { type: string; items: { properties: Record<string, { type: string; nullable?: boolean; enum?: string[] }> } } }; additionalProperties?: unknown };
    expect(s.type).toBe("OBJECT");
    expect("additionalProperties" in s).toBe(false);
    expect(s.properties.places.type).toBe("ARRAY");
    expect(s.properties.places.items.properties.name.type).toBe("STRING");
    expect(s.properties.places.items.properties.area).toMatchObject({ type: "STRING", nullable: true });
    expect(s.properties.places.items.properties.kind.enum).toEqual(["fort", "lake"]);
  });
  it("forces the single tool, sends text AND images, and keeps the system prompt separate", () => {
    const body = buildGeminiRequest({ system: "Extract places", content, tool, maxTokens: 500 });
    expect(body.toolConfig.functionCallingConfig).toEqual({ mode: "ANY", allowedFunctionNames: ["report_places"] });
    expect(body.systemInstruction.parts[0].text).toBe("Extract places");
    expect(body.contents[0].parts).toEqual([{ text: "Visit Kondapalli Fort" }, { inline_data: { mime_type: "image/png", data: "QUJD" } }]);
    // 2.5 Flash would spend a small token limit on "thinking" and answer nothing: thinking is off, the limit is generous.
    // the default is now "gemini-flash-latest" (thinking can't be switched off there): a big limit leaves room for the answer
    expect(body.generationConfig).toEqual({ maxOutputTokens: 8192, temperature: 0 });
    // 2.5 Flash would spend a small token limit on thinking and answer nothing: thinking is off there, the limit is generous
    expect(buildGeminiRequest({ system: "s", content, tool, maxTokens: 500, model: "gemini-2.5-flash" }).generationConfig).toEqual({ maxOutputTokens: 2048, temperature: 0, thinkingConfig: { thinkingBudget: 0 } });
    expect(buildGeminiRequest({ system: "s", content, tool, maxTokens: 9000, model: "gemini-2.5-pro" }).generationConfig).toEqual({ maxOutputTokens: 9000, temperature: 0 });
  });
  it("reads the structured answer and refuses anything else", () => {
    const ok = { candidates: [{ content: { parts: [{ functionCall: { name: "report_places", args: { places: [{ name: "Kondapalli Fort" }] } } }] } }] };
    expect(parseGeminiResponse(ok, "report_places")).toEqual({ places: [{ name: "Kondapalli Fort" }] });
    expect(() => parseGeminiResponse({ candidates: [{ content: { parts: [{ text: "hello" }] } }] }, "report_places")).toThrow(AiRequestError);
    expect(() => parseGeminiResponse({}, "report_places")).toThrow(AiRequestError);
    // the reason is in the message, so a failed test says WHY
    expect(() => parseGeminiResponse({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] }, "report_places")).toThrow(/finishReason: MAX_TOKENS/);
    expect(() => parseGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } }, "report_places")).toThrow(/blocked: SAFETY/);
  });
  it("sends the key in a header (never the URL), uses the configured model, and maps errors", async () => {
    vi.stubEnv("GEMINI_API_KEY", "AIzaSecret123");
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: "report_places", args: { places: [] } } }] } }] }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    expect(await callGemini({ system: "s", content, tool })).toEqual({ places: [] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/models/${GEMINI_DEFAULT_MODEL}:generateContent`);
    expect(url).not.toContain("AIzaSecret123");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIzaSecret123");

    vi.stubEnv("GEMINI_MODEL", "gemini-custom");
    await callGemini({ system: "s", content, tool });
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toContain("/models/gemini-custom:");

    const fail = (status: number, body: string) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status, text: async () => body }) as unknown as Response));
    fail(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}');
    await expect(callGemini({ system: "s", content, tool })).rejects.toMatchObject({ status: 401 });   // a wrong key is reported as a rejected key
    fail(404, '{"error":{"code":404,"message":"models/gemini-old is not found for API version v1beta, or is not supported for generateContent."}}');
    await expect(callGemini({ system: "s", content, tool })).rejects.toThrow(/models\/gemini-old is not found/);   // the reason is shown, so the model name can be fixed
    fail(429, "quota");
    await expect(callGemini({ system: "s", content, tool })).rejects.toMatchObject({ status: 429 });   // free-tier limit: the app says "try again in a minute"
  });
  it("says 'not configured' (with the variable name) when there is no key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(callGemini({ system: "s", content, tool })).rejects.toMatchObject({ envName: "GEMINI_API_KEY" });
    await expect(callGemini({ system: "s", content, tool })).rejects.toBeInstanceOf(AiNotConfiguredError);
  });
});

describe("OpenAI-compatible adapter (xAI Grok, Groq, OpenRouter, OpenAI)", () => {
  it("builds a tool-forced chat request with images as data URLs", () => {
    const b = buildChatRequest({ model: "grok-4", system: "sys", content, tool, maxTokens: 300 });
    expect(b.tool_choice).toEqual({ type: "function", function: { name: "report_places" } });
    expect(b.messages[0]).toEqual({ role: "system", content: "sys" });
    expect((b.messages[1].content as { type: string; image_url?: { url: string } }[])[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } });
  });
  it("parses the tool call arguments and rejects garbage", () => {
    const ok = { choices: [{ message: { tool_calls: [{ function: { name: "report_places", arguments: '{"places":[{"name":"X"}]}' } }] } }] };
    expect(parseChatResponse(ok, "report_places")).toEqual({ places: [{ name: "X" }] });
    expect(() => parseChatResponse({ choices: [{ message: { tool_calls: [{ function: { name: "report_places", arguments: "{not json" } }] } }] }, "report_places")).toThrow(AiRequestError);
    expect(() => parseChatResponse({ choices: [{ message: {} }] }, "report_places")).toThrow(AiRequestError);
  });
  it("calls the configured base URL with a Bearer key and needs a model name", async () => {
    vi.stubEnv("OPENAI_API_KEY", "xai-secret");
    vi.stubEnv("OPENAI_BASE_URL", "https://api.x.ai/v1/");
    await expect(callOpenAiCompatible({ system: "s", content, tool })).rejects.toThrow(/OPENAI_MODEL/);
    vi.stubEnv("OPENAI_MODEL", "grok-4");
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: "report_places", arguments: '{"places":[]}' } }] } }] }) }) as unknown as Response);
    vi.stubGlobal("fetch", f);
    expect(await callOpenAiCompatible({ system: "s", content, tool })).toEqual({ places: [] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer xai-secret");
  });
});

describe("Gemini is often busy on the free tier: retry, then fall back, but never hide a bad key", () => {
  const okBody = { candidates: [{ content: { parts: [{ functionCall: { name: "report_places", args: { places: [] } } }] } }] };
  const ok = () => ({ ok: true, status: 200, json: async () => okBody }) as unknown as Response;
  const bad = (status: number, message = "x") => ({ ok: false, status, text: async () => JSON.stringify({ error: { message } }) }) as unknown as Response;
  const run = async (responses: Response[]) => {
    vi.useFakeTimers();
    vi.stubEnv("GEMINI_API_KEY", "AQ.Aexamplekeyexamplekeyexamplekeyexamplekey1234");
    const f = vi.fn(async () => responses.shift() ?? bad(503));
    vi.stubGlobal("fetch", f);
    const p = callGemini({ system: "s", content, tool });
    const settled = p.then((v) => ({ v }), (e) => ({ e }));
    await vi.runAllTimersAsync();
    const out = await settled;
    vi.useRealTimers();
    return { out, urls: f.mock.calls.map((c) => String((c as unknown as [string])[0])) };
  };
  afterEach(() => vi.useRealTimers());

  it("a busy answer (503) is retried and then succeeds — you never see it", async () => {
    const { out, urls } = await run([bad(503, "high demand"), bad(503, "high demand"), ok()]);
    expect(out).toEqual({ v: { places: [] } });
    expect(urls).toHaveLength(3);
    expect(new Set(urls).size).toBe(1);                                  // same model all three times
  });
  it("if the main model stays busy, the lighter model answers", async () => {
    const { out, urls } = await run([bad(503), bad(503), bad(503), ok()]);
    expect(out).toEqual({ v: { places: [] } });
    expect(urls[3]).toContain("gemini-flash-lite-latest");
  });
  it("a retired model (404) or a used-up limit (429) goes straight to the lighter model", async () => {
    expect((await run([bad(404, "no longer available"), ok()])).urls[1]).toContain("gemini-flash-lite-latest");
    expect((await run([bad(429, "quota"), ok()])).urls[1]).toContain("gemini-flash-lite-latest");
  });
  it("a bad key is reported at once, not retried", async () => {
    const { out, urls } = await run([bad(400, "API key not valid. Please pass a valid API key.")]);
    expect(out).toMatchObject({ e: { status: 401 } });
    expect(urls).toHaveLength(1);
  });
  it("when everything is busy it gives up with the real reason (after a bounded number of tries)", async () => {
    const { out, urls } = await run([]);                                   // every call answers 503
    expect(out).toMatchObject({ e: { status: 503 } });
    expect(urls.length).toBe(6);                                          // 3 tries x 2 models, then stop
  });
});
