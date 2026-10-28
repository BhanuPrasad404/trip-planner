// Why "The AI didn't answer in time" happened: the Flash model was left THINKING (slow). The call now asks it not to think, in the
// way the model accepts, remembers that, and the wait stops the request when time is up.
import { afterEach, describe, expect, it, vi } from "vitest";
import { callGemini } from "@/lib/ai/gemini";
import { AiRequestError, type ToolSpec } from "@/lib/ai/types";
import { AiSlowError, aiReadTrip } from "@/lib/intake/ai-read";

const tool: ToolSpec = { name: "report", description: "d", input_schema: { type: "object", properties: {} } };
const content = [{ type: "text" as const, text: "hi" }];
const OK = { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: "report", args: { done: true } } }] } }] }) } as unknown as Response;
const bad400 = (message: string) => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message } }) }) as unknown as Response;
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

function setup(model: string) {
  vi.stubEnv("GEMINI_API_KEY", "AIzaTestKey1234567890"); vi.stubEnv("GEMINI_MODEL", model); vi.stubEnv("GEMINI_FALLBACK_MODEL", model);
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Gemini: not thinking", () => {
  it("a Flash model is asked not to think from the first request", async () => {
    setup("gemini-flash-test-a");
    const f = vi.fn(async () => OK); vi.stubGlobal("fetch", f);
    await callGemini({ system: "s", content, tool });
    expect(bodyOf(f.mock.calls[0]).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });
  it("when the model rejects that setting it tries the next way, then remembers the one that works", async () => {
    setup("gemini-flash-test-b");
    const f = vi.fn()
      .mockResolvedValueOnce(bad400("Budget 0 is invalid. This model only works in thinking mode."))
      .mockResolvedValueOnce(OK).mockResolvedValue(OK);
    vi.stubGlobal("fetch", f);
    expect(await callGemini({ system: "s", content, tool })).toEqual({ done: true });
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f.mock.calls[1]).generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
    await callGemini({ system: "s", content, tool }); // next time: straight to the setting that worked
    expect(f).toHaveBeenCalledTimes(3);
    expect(bodyOf(f.mock.calls[2]).generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
  });
  it("a model that always thinks (Pro) is sent no thinking setting and a roomy limit", async () => {
    setup("gemini-pro-test-c");
    const f = vi.fn(async () => OK); vi.stubGlobal("fetch", f);
    await callGemini({ system: "s", content, tool });
    expect(bodyOf(f.mock.calls[0]).generationConfig).toEqual({ maxOutputTokens: 8192, temperature: 0 });
  });
  it("a bad-key 400 is a real error and is not retried with other settings", async () => {
    setup("gemini-flash-test-d");
    const f = vi.fn(async () => bad400("API key not valid. Please pass a valid API key.")); vi.stubGlobal("fetch", f);
    await expect(callGemini({ system: "s", content, tool })).rejects.toMatchObject({ status: 401 });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("does nothing at all when the wait is already over", async () => {
    setup("gemini-flash-test-e");
    const f = vi.fn(async () => OK); vi.stubGlobal("fetch", f);
    const stop = new AbortController(); stop.abort();
    await expect(callGemini({ system: "s", content, tool, signal: stop.signal })).rejects.toBeInstanceOf(AiRequestError);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("the AI wait", () => {
  it("stops the request when time is up, and says it was slow", async () => {
    let seen: AbortSignal | undefined;
    const llm = vi.fn(({ signal }: { signal?: AbortSignal }) => { seen = signal; return new Promise<unknown>(() => undefined); });
    await expect(aiReadTrip("3 days", llm as never, { todayMonth: 10, timeoutMs: 30 })).rejects.toBeInstanceOf(AiSlowError);
    expect(seen?.aborted).toBe(true);
  });
  it("waits longer than the old 12 seconds by default", async () => {
    const { AI_READ_TIMEOUT_MS } = await import("@/lib/intake/ai-read");
    expect(AI_READ_TIMEOUT_MS).toBeGreaterThan(12_000);
    expect(AI_READ_TIMEOUT_MS).toBeLessThan(30_000); // the route's own limit is 30 s
  });
});
