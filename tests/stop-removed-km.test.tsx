// Reproduction of the reported bug: "start → stop 1 → I added stop 2 and deleted stop 1. The blue route was right, but the screen
// showed about double the distance". The road legs measured THROUGH the deleted stop were still used after the delete.
// A fake routing service measures every leg from the points it is given (straight line × 1.3), so no distance is hard-coded:
// the assertions compare against what the legs SHOULD be for the stops that remain.
import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { distanceKm } from "@/lib/geo";
import { summarizeDrive } from "@/lib/live";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => ({ upsert: async () => ({ error: null }), delete: () => ({ eq: () => ({ eq: async () => ({}) }) }) }) }) }));
vi.mock("@/lib/client/use-live-members", () => ({ useLiveMembers: () => ({}) }));
vi.mock("@/lib/client/location-env", () => ({ readLocationEnv: async () => null }));
import { useDrive, type Drive, type DriveTarget } from "@/lib/client/use-drive";

type P = { lat: number; lng: number };
const ROAD = 1.3;
const leg = (a: P, b: P) => ({ km: Math.round(distanceKm(a, b) * ROAD * 10) / 10, minutes: Math.round(distanceKm(a, b) * ROAD * 2) });

// Any three places work; these are only coordinates for the fake router.
const ME: P = { lat: 17.3688, lng: 78.5247 };
const S1: DriveTarget = { id: "s1", name: "Stop one", lat: 17.4062, lng: 78.4691, plannedArrival: null };
const S2: DriveTarget = { id: "s2", name: "Stop two", lat: 17.4086, lng: 78.5970, plannedArrival: null };
const S3: DriveTarget = { id: "s3", name: "Stop three", lat: 17.45, lng: 78.65, plannedArrival: null };

let requests: P[][];
let pending: { points: P[]; resolve: () => void }[];
let autoAnswer: boolean;
let onPos: ((p: unknown) => void) | null;

beforeEach(() => {
  requests = []; pending = []; autoAnswer = true; onPos = null;
  const win: Record<string, unknown> = { setInterval, clearInterval, isSecureContext: true, addEventListener() {}, removeEventListener() {} };
  win.self = win; win.top = win;
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" });
  vi.stubGlobal("navigator", { geolocation: { watchPosition: (cb: (p: unknown) => void) => { onPos = cb; return 1; }, clearWatch() {}, getCurrentPosition() {} } });
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    const points = (JSON.parse(init.body as string) as { points: P[] }).points;
    requests.push(points);
    const answer = () => ({ ok: true, status: 200, json: async () => ({ legs: points.slice(1).map((p, i) => leg(points[i], p)), line: points.map((p) => [p.lng, p.lat]), source: "osrm" }) });
    if (autoAnswer) return Promise.resolve(answer());
    return new Promise((res) => pending.push({ points, resolve: () => res(answer()) }));
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

let drive!: Drive;
let stops: DriveTarget[];
const allow = { current: true };
function Harness() {
  // eslint-disable-next-line react-hooks/globals -- test harness: expose the hook's latest values
  drive = useDrive("trip", "me", stops, allow);
  return null;
}
let r: TestRenderer.ReactTestRenderer;
afterEach(() => { act(() => r?.unmount()); });

const mount = async (initial: DriveTarget[]) => {
  stops = initial;
  await act(async () => { r = TestRenderer.create(createElement(Harness)); });
  await act(async () => { drive.start(); });
  await act(async () => { onPos!({ coords: { latitude: ME.lat, longitude: ME.lng, accuracy: 8, speed: 0, heading: null }, timestamp: Date.now() }); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};
/** The traveller's stops change (a delete arrives) — and NO new GPS reading comes (parked, or a chosen start point). */
const setStops = async (next: DriveTarget[]) => {
  stops = next;
  await act(async () => { r.update(createElement(Harness)); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};
/** What DrivePanel shows: the same pairing of route legs with the stops it can find. */
const shownTotalKm = () => {
  const route = drive.route;
  if (!route) return null;
  const byId = new Map(stops.map((s) => [s.id, s]));
  const routeStops = route.stopIds.map((id) => byId.get(id)).filter((s): s is DriveTarget => !!s);
  return summarizeDrive(route.legs, routeStops, 600, false)?.totalKm ?? null;
};
const sum = (pts: P[]) => Math.round(pts.slice(1).reduce((a, p, i) => a + leg(pts[i], p).km, 0) * 10) / 10;

describe("a stop is deleted while driving: its road legs are never used again", () => {
  it("delete the CURRENT target: the numbers are recalculated at once from my position to the next stop", async () => {
    await mount([S1, S2]);
    const before = shownTotalKm();
    expect(before).toBe(sum([ME, S1, S2]));
    await setStops([S2]); // stop 1 deleted
    const after = shownTotalKm();
    console.info(`[repro] me → stop 1 → stop 2: ${before} km; after deleting stop 1: ${after} km (correct: ${sum([ME, S2])} km)`);
    expect(requests.at(-1)).toEqual([ME, { lat: S2.lat, lng: S2.lng }]);
    expect(after).toBe(sum([ME, S2]));
    expect(drive.route?.stopIds).toEqual(["s2"]);
  });

  it("delete a LATER stop: the km drops by exactly that stop's legs", async () => {
    await mount([S1, S2, S3]);
    expect(shownTotalKm()).toBe(sum([ME, S1, S2, S3]));
    await setStops([S1, S3]);
    expect(shownTotalKm()).toBe(sum([ME, S1, S3]));
    expect(drive.route?.stopIds).toEqual(["s1", "s3"]);
  });

  it("delete the LAST stop: no route, no number at all", async () => {
    await mount([S1]);
    await setStops([]);
    expect(drive.route).toBeNull();
    expect(shownTotalKm()).toBeNull();
  });

  it("a slow answer requested BEFORE the delete is ignored when it arrives after it", async () => {
    autoAnswer = false;
    await mount([S1, S2]);
    expect(pending).toHaveLength(1); // asked for me → stop 1 → stop 2, still on its way
    await setStops([S2]);
    // While the old answer is still out, nothing old is shown.
    expect(drive.route).toBeNull();
    await act(async () => { pending[0].resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(drive.route?.stopIds ?? null).not.toEqual(["s1", "s2"]);
    // The fresh request for the remaining stops is answered: only that one counts.
    const fresh = pending.find((p) => p.points.length === 2);
    expect(fresh?.points).toEqual([ME, { lat: S2.lat, lng: S2.lng }]);
    await act(async () => { fresh!.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(drive.route?.stopIds).toEqual(["s2"]);
    expect(shownTotalKm()).toBe(sum([ME, S2]));
  });
});

describe("Task 10 at the hook: the points sent to /api/eta", () => {
  it("first point = my GPS reading (never the trip's start), then only the remaining stops, in order", async () => {
    await mount([S1, S2, S3]);
    expect(requests[0]).toEqual([ME, ...[S1, S2, S3].map((s) => ({ lat: s.lat, lng: s.lng }))]);
    await setStops([S1, S3]);
    expect(requests.at(-1)).toEqual([ME, { lat: S1.lat, lng: S1.lng }, { lat: S3.lat, lng: S3.lng }]);
  });

  it("routing failed → the numbers are marked 'estimated'; routing back → road numbers again", async () => {
    const { remainingDistance } = await import("@/lib/trip/remaining");
    const { assessFix } = await import("@/lib/location/quality");
    const realFetch = globalThis.fetch as unknown as (u: string, i: RequestInit) => Promise<{ json: () => Promise<Record<string, unknown>> }>;
    let source = "estimate";
    vi.stubGlobal("fetch", async (u: string, i: RequestInit) => { const res = await realFetch(u, i); const body = await res.json(); return { ok: true, status: 200, json: async () => ({ ...body, source }) }; });
    await mount([S1, S2]);
    const left = () => remainingDistance({ targets: stops, route: drive.route, nav: null, me: drive.me, quality: assessFix(drive.me, drive.me!.at), nowMs: drive.me!.at });
    expect(left()?.basis).toBe("estimated");
    expect(left()?.exact).toBe(false);
    source = "osrm";
    await setStops([S2]); // any re-measure (here: a stop removed) asks again
    expect(left()?.basis).toBe("road");
    expect(left()?.exact).toBe(true);
  });
});
