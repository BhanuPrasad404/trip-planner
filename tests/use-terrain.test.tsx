import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTerrain } from "@/lib/client/use-terrain";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Line = [number, number][];
let out: ReturnType<typeof useTerrain>;
function Harness({ line, enabled }: { line: Line | null; enabled: boolean }) {
  // eslint-disable-next-line react-hooks/globals -- test harness: expose the hook's latest values
  out = useTerrain(line, enabled);
  return null;
}
let seed = 0;
const mkLine = (): Line => { seed += 1; return [[78 + seed, 17], [78.2 + seed, 17.1], [78.5 + seed, 17.2]]; };
const RESULT = { source: { provider: "open-meteo", label: "Open-Meteo elevation", approximate: true }, retrievedAt: 1, totalKm: 40, segments: [], stats: { minM: 300, maxM: 500, totalClimbM: 200, totalDescentM: 0 }, profile: [] };
let fetchMock: ReturnType<typeof vi.fn>;
let r: TestRenderer.ReactTestRenderer;
const mount = async (line: Line | null, enabled: boolean) => { await act(async () => { r = TestRenderer.create(createElement(Harness, { line, enabled })); }); await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
beforeEach(() => { fetchMock = vi.fn(async () => new Response(JSON.stringify(RESULT), { status: 200 })); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { act(() => r?.unmount()); vi.unstubAllGlobals(); });

describe("useTerrain", () => {
  it("does nothing until the traveller asks (no request when not enabled)", async () => {
    await mount(mkLine(), false);
    expect(fetchMock).not.toHaveBeenCalled(); expect(out).toEqual({ result: null, loading: false, error: null });
  });
  it("when asked: loading, then the result", async () => {
    await mount(mkLine(), true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.loading).toBe(false); expect(out.result?.stats?.maxM).toBe(500); expect(out.error).toBeNull();
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe("/api/terrain");
  });
  it("the same route is not fetched twice", async () => {
    const line = mkLine();
    await mount(line, true);
    await act(async () => { r.update(createElement(Harness, { line: [...line], enabled: true })); });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(out.result).not.toBeNull();
  });
  it("an error answer becomes a plain message, never a crash, and never a result", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "The elevation service isn't available right now." }), { status: 502 }));
    await mount(mkLine(), true);
    expect(out).toEqual({ result: null, loading: false, error: "The elevation service isn't available right now." });
  });
  it("a network failure is also a plain message", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await mount(mkLine(), true);
    expect(out.error).toBe("offline"); expect(out.result).toBeNull();
  });
  it("no route, no request", async () => {
    await mount(null, true);
    expect(fetchMock).not.toHaveBeenCalled(); expect(out.loading).toBe(false);
  });
});
