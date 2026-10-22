import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_PAUSE_MS, SHORT_PAUSE_MS, clearPlaceSearchMemory, usePlaceSearch } from "@/lib/client/use-place-search";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hit = (name: string, source = "geonames") => ({ id: `${source}:${name}`, name, lat: 17.4, lng: 78.4, kind: "town", area: "Telangana", state: "Telangana", source });
type Out = ReturnType<typeof usePlaceSearch>;
let out: Out;
function Harness({ q, online = true }: { q: string; online?: boolean }) {
  // eslint-disable-next-line react-hooks/globals -- test harness: expose the hook's latest values
  out = usePlaceSearch(q, null, { online });
  return null;
}
let renderer: TestRenderer.ReactTestRenderer;
let fetchMock: ReturnType<typeof vi.fn>;
const layers = () => fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)) as { q: string; layer: string });
const type = async (q: string, online = true) => { await act(async () => { if (renderer) renderer.update(createElement(Harness, { q, online })); else renderer = TestRenderer.create(createElement(Harness, { q, online })); }); };
const wait = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  clearPlaceSearchMemory();
  fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
    const { q, layer } = JSON.parse(String(init.body)) as { q: string; layer: string };
    const results = layer === "local" ? [hit(`${q} town`)] : layer === "map" ? [hit(`${q} town`), hit(`${q} fort`, "osm")] : [hit(`${q} museum`, "osm")];
    return new Response(JSON.stringify({ results, status: "ok", sources: [...new Set(results.map((r) => r.source))] }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderer = undefined as unknown as TestRenderer.ReactTestRenderer;
});
afterEach(() => { act(() => renderer?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("type-ahead — no Search button", () => {
  it("one letter: nothing is sent", async () => {
    await type("h"); await wait(2000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("fast typing sends nothing until the pause; then our list first, the map after the longer pause", async () => {
    await type("ha"); await wait(100);
    await type("ham"); await wait(100);
    await type("hamp"); await wait(100);
    expect(fetchMock).not.toHaveBeenCalled();
    await wait(SHORT_PAUSE_MS);
    expect(layers()).toEqual([{ q: "hamp", layer: "local", near: null }].map(({ q, layer }) => expect.objectContaining({ q, layer })));
    expect(out.results?.map((r) => r.name)).toEqual(["hamp town"]);
    await wait(LONG_PAUSE_MS);
    expect(layers().map((l) => l.layer)).toEqual(["local", "map"]);
    expect(out.results?.map((r) => r.name)).toEqual(["hamp town", "hamp fort"]);
    expect(out.map).toBe("done");
  });
  it("2 letters ask our list only; the map needs 3", async () => {
    await type("go"); await wait(2000);
    expect(layers().map((l) => l.layer)).toEqual(["local"]);
  });
  it("deleting a letter and typing it again sends nothing new (answers are remembered)", async () => {
    await type("hampi"); await wait(2000);
    const n = fetchMock.mock.calls.length;
    await type("hamp"); await wait(2000);
    await type("hampi"); await wait(2000);
    expect(fetchMock.mock.calls.length).toBe(n + 2); // only "hamp" (local + map) was new
  });
  it("a request still on its way is cancelled when the text changes", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_u: string, init: RequestInit) => { signals.push(init.signal!); return new Promise(() => {}); });
    await type("goa"); await wait(SHORT_PAUSE_MS + 10);
    await type("goal"); await wait(SHORT_PAUSE_MS + 10);
    expect(signals[0].aborted).toBe(true);
  });
  it("offline: nothing is sent", async () => {
    await type("hampi", false); await wait(2000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.waiting).toBe(false);
  });
  it("a server error is shown as an error, not as 'no places'", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Slow down a little and try again in a minute." }), { status: 429 }));
    await type("ooty"); await wait(SHORT_PAUSE_MS + 10);
    expect(out.error).toBe("Slow down a little and try again in a minute.");
    expect(out.results).toBeNull();
  });
  it("'Search more' runs only when asked, and keeps what the map found", async () => {
    await type("araku"); await wait(2000);
    expect(layers().map((l) => l.layer)).toEqual(["local", "map"]);
    act(() => out.searchMore());
    await wait(10);
    expect(layers().map((l) => l.layer)).toEqual(["local", "map", "more"]);
    expect(out.results?.map((r) => r.name)).toEqual(["araku museum", "araku town", "araku fort"]);
  });
});
