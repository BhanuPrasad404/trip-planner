import { describe, expect, it, vi } from "vitest";
import { Fatal, transientStatus, withRetry } from "@/lib/client/retry";

const noSleep = { sleep: async () => undefined };

describe("withRetry", () => {
  it("returns at once when the first try works", async () => {
    const fn = vi.fn(async () => "ok");
    expect(await withRetry(fn, noSleep)).toBe("ok"); expect(fn).toHaveBeenCalledTimes(1);
  });
  it("recovers from a couple of transient failures", async () => {
    let n = 0;
    expect(await withRetry(async () => { if (++n < 3) throw new Error("network"); return "done"; }, noSleep)).toBe("done");
    expect(n).toBe(3);
  });
  it("gives up after the last try and reports the real error", async () => {
    const fn = vi.fn(async () => { throw new Error("still down"); });
    await expect(withRetry(fn, noSleep)).rejects.toThrow("still down"); expect(fn).toHaveBeenCalledTimes(3);
  });
  it("never retries a refusal", async () => {
    const fn = vi.fn(async () => { throw new Fatal("Videos can be up to 30 seconds"); });
    await expect(withRetry(fn, noSleep)).rejects.toThrow(/30 seconds/); expect(fn).toHaveBeenCalledTimes(1);
  });
  it("waits longer each time", async () => {
    const waits: number[] = [];
    await withRetry(async () => { throw new Error("x"); }, { tries: 4, baseMs: 100, sleep: async (ms) => { waits.push(ms); } }).catch(() => undefined);
    expect(waits).toEqual([100, 200, 400]);
  });
  it("knows which statuses are worth another try", () => {
    expect([408, 429, 500, 502, 503].every(transientStatus)).toBe(true);
    expect([200, 400, 401, 403, 404, 409, 413, 422].some(transientStatus)).toBe(false);
  });
});
