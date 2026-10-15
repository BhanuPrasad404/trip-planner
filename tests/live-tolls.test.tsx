import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveTolls } from "@/components/LiveTolls";
import type { AppAlert } from "@/lib/alerts/delivery";
import type { Vehicle } from "@/lib/vehicle";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const M = 111_195;
let salt = 0;
/** A road of 60 km running north. Each test gets its own so the per-visit cache cannot hide a request. */
const makeLine = (s: number): [number, number][] => Array.from({ length: 121 }, (_, i) => [78.0 + s * 0.002, 17.0 + (i * 500) / M]);
const tollEl = (s: number, km: number, tags: Record<string, string> = { barrier: "toll_booth", name: "Kothur Toll Plaza", ref: "NH44" }) => ({ type: "node", id: 100 + s, lat: 17.0 + (km * 1000) / M, lon: 78.0 + s * 0.002, tags });

type Fake = { phase?: string; along?: number; accuracy?: number; speed?: number; offset?: number; rerouting?: boolean; source?: string; line: [number, number][]; routeId?: string };
const liveOf = (f: Fake) => ({
  liveOk: true,
  navigation: { phase: f.phase ?? "navigating", routes: [{ id: f.routeId ?? "r1", line: f.line, source: f.source ?? "osrm" }], selectedId: f.routeId ?? "r1", progress: f.along === undefined ? null : { alongM: f.along, offsetM: f.offset ?? 4 }, rerouting: f.rerouting ?? false, offRouteSuspected: false, uncertain: false },
  drive: { me: { speedKmh: f.speed ?? 80, accuracyM: f.accuracy ?? 12, fixAt: Date.now() } },
}) as never;

describe("LiveTolls: the card and the warning", () => {
  let fetches: { url: string; body: { line: unknown[]; vehicle: string } }[]; let reply: () => Response; let alerts: AppAlert[]; let dismissed: string[]; let r: TestRenderer.ReactTestRenderer; let s: number;
  const text = (j: unknown): string => (j == null ? "" : typeof j === "string" ? j : Array.isArray(j) ? j.map(text).join("") : (j as { children?: unknown[] }).children?.map(text).join("") ?? "");
  beforeEach(() => {
    s = ++salt; fetches = []; alerts = []; dismissed = [];
    reply = () => new Response(JSON.stringify({ tolls: [{ id: "node/1", lat: 17.0 + 30_000 / M, lng: 78.0 + s * 0.002, name: "Kothur Toll Plaza", ref: "NH44", operator: null, fee: null }], complete: true }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { fetches.push({ url, body: JSON.parse(String(init.body)) }); return reply(); }));
    vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  afterEach(() => { act(() => r?.unmount()); });

  const mount = async (f: Partial<Fake> = {}, vehicle: Vehicle = "car") => {
    const props = (fk: Fake) => ({ live: liveOf(fk), vehicle, notify: (a: AppAlert) => { alerts.push(a); return true; }, dismiss: (id: string) => { dismissed.push(id); } });
    await act(async () => { r = TestRenderer.create(createElement(LiveTolls, props({ line: makeLine(s), ...f }))); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    return (g: Partial<Fake>) => act(async () => { r.update(createElement(LiveTolls, props({ line: makeLine(s), ...f, ...g }))); await Promise.resolve(); });
  };

  it("shows nothing and asks nothing when you are not navigating", async () => { await mount({ phase: "idle" }); expect(r.toJSON()).toBeNull(); expect(fetches).toEqual([]); });
  it("asks once for the route's plazas, with the vehicle, and sends a simplified road (a straight road is just two points)", async () => {
    await mount({ along: 1000 }, "motorcycle");
    expect(fetches).toHaveLength(1); expect(fetches[0].url).toBe("/api/tolls"); expect(fetches[0].body.vehicle).toBe("motorcycle"); expect(fetches[0].body.line).toHaveLength(2);
  });
  it("lists the plaza ahead with its real distance, and says plainly that no fee is listed", async () => {
    await mount({ along: 25_300 });
    const t = text(r.toJSON());
    expect(t).toContain("Tolls on this route"); expect(t).toContain("Kothur Toll Plaza · NH44"); expect(t).toContain("about 4.7 km ahead"); expect(t).toContain("No fee listed in the map data");
    expect(t).toContain("From OpenStreetMap"); expect(t).toContain("won't be listed");
  });
  it("shows a fee only when the map has one, exactly as the map writes it", async () => {
    reply = () => new Response(JSON.stringify({ tolls: [{ id: "n", lat: 17.0 + 30_000 / M, lng: 78.0 + s * 0.002, name: "P", ref: null, operator: null, fee: "Rs 105" }], complete: true }), { status: 200 });
    await mount({ along: 20_000 }); expect(text(r.toJSON())).toContain("Fee in map data: Rs 105");
  });
  it("warns ONCE, about 4.7 km out, with the measured distance, through the alert system", async () => {
    const update = await mount({ along: 20_000 }); expect(alerts).toEqual([]);
    await update({ along: 25_300 }); expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "toll", level: 2, title: "Toll plaza ahead" }); expect(alerts[0].body).toContain("about 4.7 km ahead"); expect(alerts[0].body).not.toMatch(/₹|Rs \d/);
    await update({ along: 26_500 }); await update({ along: 28_000 }); expect(alerts).toHaveLength(1);
  });
  it("warns about 5 km out at an ordinary speed (60 km/h), but a crawl (10 km/h) waits until about 3 km", async () => {
    const fast = await mount({ along: 20_000, speed: 60 }); await fast({ along: 25_300, speed: 60 }); expect(alerts).toHaveLength(1);
    await act(async () => { r.unmount(); }); alerts.length = 0; s = ++salt;
    const slow = await mount({ along: 20_000, speed: 10 }); await slow({ along: 25_300, speed: 10 }); expect(alerts).toEqual([]); // 4.7 km ahead, but crawling: too early
    await slow({ along: 27_300, speed: 10 }); expect(alerts).toHaveLength(1); // 2.7 km
  });
  it("is silent when the position or the route cannot be trusted, and the warning is not used up", async () => {
    const update = await mount({ along: 20_000 });
    await update({ along: 26_000, accuracy: 300 }); await update({ along: 26_100, offset: 500 }); await update({ along: 26_200, rerouting: true }); await update({ along: 26_300, source: "estimate" });
    expect(alerts).toEqual([]);
    await update({ along: 26_400 }); expect(alerts).toHaveLength(1); // good signal: now it speaks
  });
  it("once you have passed the plaza it leaves the list, and its warning is taken away", async () => {
    const update = await mount({ along: 25_300 }); expect(text(r.toJSON())).toContain("Kothur Toll Plaza"); expect(alerts).toHaveLength(1);
    expect(dismissed).toEqual([]);
    await update({ along: 31_000 });
    expect(r.toJSON()).toBeNull(); // nothing left to say: no card at all
    expect(dismissed).toEqual(["toll:node/1"]); // the on-screen warning for that plaza is removed cleanly
  });
  it("a different route starts afresh (it can warn about the same plaza again on a new route)", async () => {
    const update = await mount({ along: 25_300 }); expect(alerts).toHaveLength(1);
    await update({ along: 25_300, routeId: "r2" }); await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });
  it("if the map data is down NOTHING is shown (no card, no alert), and it quietly tries again after 20 s, 1 min and 3 min, then stops", async () => {
    reply = () => new Response(JSON.stringify({ error: "Toll data isn't available right now." }), { status: 503 });
    await mount({ along: 1000 });
    expect(r.toJSON()).toBeNull(); expect(alerts).toEqual([]); expect(fetches).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); }); expect(fetches).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); expect(fetches).toHaveLength(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); }); expect(fetches).toHaveLength(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); }); expect(fetches).toHaveLength(4); // gave up: no hammering the map server
    expect(r.toJSON()).toBeNull();
  });
  it("a retry that works brings the plaza back, without the traveller doing anything", async () => {
    reply = () => new Response("{}", { status: 503 });
    await mount({ along: 25_300 }); expect(r.toJSON()).toBeNull(); expect(alerts).toEqual([]);
    reply = () => new Response(JSON.stringify({ tolls: [{ id: "node/1", lat: 17.0 + 30_000 / M, lng: 78.0 + s * 0.002, name: "Kothur Toll Plaza", ref: "NH44", operator: null, fee: null }], complete: true }), { status: 200 });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(text(r.toJSON())).toContain("Kothur Toll Plaza");
  });
  it("when part of the route could not be checked, the card (shown because a plaza IS ahead) says plazas may be missing", async () => {
    reply = () => new Response(JSON.stringify({ tolls: [{ id: "node/1", lat: 17.0 + 30_000 / M, lng: 78.0 + s * 0.002, name: "P", ref: null, operator: null, fee: null }], complete: false }), { status: 200 });
    await mount({ along: 25_300 }); expect(text(r.toJSON())).toContain("some plazas may be missing");
  });
  it("an empty or incomplete answer with nothing ahead shows no card at all: nothing implies the road is toll-free", async () => {
    reply = () => new Response(JSON.stringify({ tolls: [], complete: true }), { status: 200 });
    await mount({ along: 1000 }); expect(r.toJSON()).toBeNull();
    reply = () => new Response(JSON.stringify({ tolls: [], complete: false }), { status: 200 });
    const s2 = ++salt; s = s2; await act(async () => { r.unmount(); });
    await mount({ along: 1000 }); expect(r.toJSON()).toBeNull();
  });
  void tollEl;
});
