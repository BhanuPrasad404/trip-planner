import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROADS_PAUSE_MS, clearFitMeterMemory, useFitMeter } from "@/lib/client/use-fit-meter";
import { estimateMatrix } from "@/lib/providers/estimate";
import type { MeterPlace } from "@/lib/intake/fit-meter";
import type { TripAnswers } from "@/lib/intake/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HYD = { lat: 17.385, lng: 78.4867, name: "Hyderabad" };
const A: MeterPlace = { id: "w", name: "Warangal Fort", lat: 17.95, lng: 79.617, kind: "sight", must: false };
const B: MeterPlace = { id: "r", name: "Ramappa Temple", lat: 18.259, lng: 79.943, kind: "sight", must: false };
let out: ReturnType<typeof useFitMeter>;
function Harness(p: { answers: TripAnswers; places: MeterPlace[]; online?: boolean }) {
  // eslint-disable-next-line react-hooks/globals -- test harness: expose the hook's latest values
  out = useFitMeter({ answers: p.answers, start: HYD, places: p.places, online: p.online ?? true });
  return null;
}
let r: TestRenderer.ReactTestRenderer;
let fetchMock: ReturnType<typeof vi.fn>;
const show = async (p: Parameters<typeof Harness>[0]) => { await act(async () => { if (r) r.update(createElement(Harness, p)); else r = TestRenderer.create(createElement(Harness, p)); }); };
const wait = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  clearFitMeterMemory();
  r = undefined as unknown as TestRenderer.ReactTestRenderer;
  fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
    const { points } = JSON.parse(String(init.body)) as { points: { lat: number; lng: number }[] };
    return new Response(JSON.stringify(estimateMatrix(points)), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { act(() => r?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("useFitMeter — road times once per set of places, the rest on the phone", () => {
  it("asks for road times once, then answers every change instantly without asking again", async () => {
    const places = [A, B];
    await show({ answers: { days: 2 }, places });
    expect(out.meter.headline).toBe("Checking the roads…");
    await wait(ROADS_PAUSE_MS + 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.meter.level).toBe("easy");
    for (const days of [1, 3, 4]) await show({ answers: { days, pace: "relaxed" }, places });
    await wait(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.meter.headline).toMatch(/4 days/);
  });
  it("a new place → one new request (after a pause)", async () => {
    await show({ answers: { days: 2 }, places: [A] });
    await wait(ROADS_PAUSE_MS + 10);
    await show({ answers: { days: 2 }, places: [A, B] });
    await wait(ROADS_PAUSE_MS + 10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("routing failed: says so in words, no fake answer", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Today's limit for checking road times is used up. It resets within 24 hours." }), { status: 429 }));
    await show({ answers: { days: 2 }, places: [A, B] });
    await wait(ROADS_PAUSE_MS + 10);
    expect(out.meter.headline).toBe("Couldn't check the roads right now");
    expect(out.meter.detail).toMatch(/limit/);
  });
  it("offline: says the check needs the internet; nothing is sent", async () => {
    await show({ answers: { days: 2 }, places: [A, B], online: false });
    await wait(2000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.meter.headline).toBe("You're offline");
  });
});
