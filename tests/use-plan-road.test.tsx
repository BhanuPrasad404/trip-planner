import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlanRoad } from "@/lib/client/use-plan-road";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let out: ReturnType<typeof usePlanRoad>;
function Harness({ points, enabled = true }: { points: { lat: number; lng: number }[]; enabled?: boolean }) {
  // eslint-disable-next-line react-hooks/globals -- test harness: expose the hook's latest values
  out = usePlanRoad(points, enabled);
  return null;
}
const LINE: [number, number][] = [[78.4, 17.3], [79.0, 17.6], [79.6, 17.9]];
let fetchMock: ReturnType<typeof vi.fn>;
let renderer: TestRenderer.ReactTestRenderer;
// Each test uses its own coordinates so the module's road cache cannot leak between tests.
let seed = 0;
const pts = (n = 3) => { seed += 1; return Array.from({ length: n }, (_, i) => ({ lat: 10 + seed + i * 0.1, lng: 70 + seed + i * 0.1 })); };
const mount = async (points: { lat: number; lng: number }[], enabled = true) => { await act(async () => { renderer = TestRenderer.create(createElement(Harness, { points, enabled })); }); };
const settle = async (ms = 500) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ source: "osrm", line: LINE, legs: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { act(() => renderer?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("usePlanRoad — the real road for the day, never a fake one", () => {
  it("loads in the background: 'loading' first, then the road line", async () => {
    await mount(pts());
    expect(out).toEqual({ line: null, loading: true });
    await settle();
    expect(out.loading).toBe(false); expect(out.line).toEqual(LINE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("waits until the traveller stops changing things (one request, not one per change)", async () => {
    const a = pts();
    await mount(a);
    await settle(200);
    await act(async () => { renderer.update(createElement(Harness, { points: pts() })); });
    await settle(200);
    expect(fetchMock).not.toHaveBeenCalled();
    await settle(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("asks the routing endpoint for exactly these points, in order", async () => {
    const p = pts(4);
    await mount(p);
    await settle();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/eta");
    const sent = JSON.parse(String(init.body)).points as { lat: number; lng: number }[];
    expect(sent).toHaveLength(4);
    expect(sent[0].lat).toBeCloseTo(p[0].lat, 3); expect(sent[3].lng).toBeCloseTo(p[3].lng, 3);
  });
  it("a straight-line ESTIMATE is not a road: it is rejected so the map keeps its dashed line", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ source: "estimate", line: LINE, legs: [] }), { status: 200 }));
    await mount(pts());
    await settle();
    expect(out).toEqual({ line: null, loading: false });
  });
  it("a routing failure or HTTP error leaves no road (and no crash)", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 429 }));
    await mount(pts());
    await settle();
    expect(out).toEqual({ line: null, loading: false });
    fetchMock.mockRejectedValue(new Error("offline"));
    await act(async () => { renderer.update(createElement(Harness, { points: pts() })); });
    await settle();
    expect(out).toEqual({ line: null, loading: false });
  });
  it("a day already fetched comes back instantly from memory, with no second request", async () => {
    const p = pts();
    await mount(p);
    await settle();
    fetchMock.mockClear();
    await act(async () => { renderer.update(createElement(Harness, { points: pts() })); });
    await act(async () => { renderer.update(createElement(Harness, { points: p })); });
    expect(out).toEqual({ line: LINE, loading: false });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("while the points have changed and the new road is not there yet, it never shows the OLD road", async () => {
    const p = pts();
    await mount(p);
    await settle();
    expect(out.line).toEqual(LINE);
    await act(async () => { renderer.update(createElement(Harness, { points: pts() })); });
    expect(out).toEqual({ line: null, loading: true });
  });
  it("fewer than 2 points, more than 12, or disabled: nothing is requested", async () => {
    await mount(pts(1)); await settle();
    await act(async () => { renderer.update(createElement(Harness, { points: pts(13) })); }); await settle();
    await act(async () => { renderer.update(createElement(Harness, { points: pts(3), enabled: false })); }); await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toEqual({ line: null, loading: false });
  });
});
