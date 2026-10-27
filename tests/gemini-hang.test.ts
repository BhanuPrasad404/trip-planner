// The real cause of "The AI didn't answer in time": a request that HUNG was counted as "busy", so the app waited out the full
// time limit, retried the same model, and the screen's own 22-second wait ended before the lighter model was ever tried.
// A hung request must now (1) stop at its own short limit, (2) NOT be retried on the same model, (3) go straight to the other model.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ATTEMPT_TIMEOUT_MS, TIMED_OUT, callGemini } from "@/lib/ai/gemini";
import { AiRequestError, type ToolSpec } from "@/lib/ai/types";
import { AI_READ_TIMEOUT_MS } from "@/lib/intake/ai-read";
import { readWithAi } from "@/lib/intake/service";

const tool: ToolSpec = { name: "report", description: "d", input_schema: { type: "object", properties: {} } };
const content = [{ type: "text" as const, text: "hi" }];
const OK = { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: "report", args: { done: true } } }] } }] }) } as unknown as Response;
const hang = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
const modelOf = (call: unknown[]) => decodeURIComponent(String(call[0]).split("/models/")[1].split(":")[0]);

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("a Gemini request that hangs", () => {
  it("is not retried on the same model: the lighter model is asked next", async () => {
    vi.stubEnv("GEMINI_API_KEY", "AIzaTestKey1234567890"); vi.stubEnv("GEMINI_MODEL", "gemini-flash-hang-a"); vi.stubEnv("GEMINI_FALLBACK_MODEL", "gemini-flash-lite-hang-a");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const f = vi.fn().mockRejectedValueOnce(hang()).mockResolvedValue(OK);
    vi.stubGlobal("fetch", f);
    expect(await callGemini({ system: "s", content, tool })).toEqual({ done: true });
    expect(f).toHaveBeenCalledTimes(2);
    expect(modelOf(f.mock.calls[0])).toBe("gemini-flash-hang-a");
    expect(modelOf(f.mock.calls[1])).toBe("gemini-flash-lite-hang-a");
  });
  it("reports a timeout (408) when every model hangs, so the screen can say so", async () => {
    vi.stubEnv("GEMINI_API_KEY", "AIzaTestKey1234567890"); vi.stubEnv("GEMINI_MODEL", "gemini-flash-hang-b"); vi.stubEnv("GEMINI_FALLBACK_MODEL", "gemini-flash-lite-hang-b");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const f = vi.fn().mockRejectedValue(hang()); vi.stubGlobal("fetch", f);
    const e = await callGemini({ system: "s", content, tool }).catch((x) => x);
    expect(e).toBeInstanceOf(AiRequestError);
    expect((e as AiRequestError).status).toBe(TIMED_OUT);
    expect(f).toHaveBeenCalledTimes(2); // one try per model, no repeat on a hang
  });
  it("two tries must fit inside the screen's wait, with room to spare", () => {
    expect(ATTEMPT_TIMEOUT_MS * 2 + 600).toBeLessThan(AI_READ_TIMEOUT_MS);
  });
  it("shows up as 'slow' (not an unexplained failure) in the answer", async () => {
    const llm = vi.fn(async () => { throw new AiRequestError("AI request timed out after 9 s", TIMED_OUT); });
    const a = await readWithAi("3 days Araku", null, { llm, allowAi: async () => true, index: async () => ({}) as never, photon: async () => [], allow: async () => true } as never);
    expect(a.status).toBe("slow");
  });
});
