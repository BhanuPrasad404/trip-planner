// Task 8: a stop in the middle of the route is deleted (by me or by another member) → the app moves on to the NEXT remaining stop at
// once, says so, and never keeps the deleted stop as the target, an empty destination, an "arrived" card for it, or its old route.
import { createElement, act, useMemo, useRef, type MutableRefObject } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeRoutes, parseOsrmDirections } from "@/lib/map/directions";
import { haversineM } from "@/lib/geo";
import { planDriveTargets } from "@/lib/map/drive-targets";
import {
  decodeRemembered, detectStopChange, encodeRemembered, rememberKey, routeMatchesTargets, stopChangeMessage, stopsSignature, REMEMBER_MS,
} from "@/lib/trip/stop-change";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Browser Supabase client used by useTripChanges ──
const rt = { listeners: [] as { kind: string; cb: () => void }[], rows: [] as Record<string, unknown>[], error: null as unknown, queries: [] as string[] };
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ select: (cols: string) => { rt.queries.push(cols); return { eq: () => ({ limit: async () => ({ data: rt.rows, error: rt.error }) }) }; } }),
    channel: () => {
      const ch = { on: (kind: string, _f: unknown, cb: () => void) => { rt.listeners.push({ kind, cb }); return ch; }, subscribe: () => ch };
      return ch;
    },
    removeChannel: async () => "ok",
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => server.client }));

import { useNavigation, type Navigation } from "@/lib/client/use-navigation";
import { useStopRemoved } from "@/lib/client/use-stop-removed";
import { useArrival } from "@/lib/client/use-arrival";
import { useTripChanges, DRIVE_CHECK_MS } from "@/lib/client/use-trip-changes";
import type { Me } from "@/lib/client/use-drive";
import type { ArrivalStop } from "@/lib/trip/arrival";
import { DELETE as deletePlace } from "@/app/api/places/[id]/route";

type Stop = { id: string; name: string; lat: number; lng: number; status: "planned" | "done" | "skipped"; day_number: number; sequence_order: number };
const mk = (id: string, name: string, lat: number, lng: number, order: number, status: Stop["status"] = "planned"): Stop => ({ id, name, lat, lng, status, day_number: 1, sequence_order: order });
const A = mk("a", "Charminar", 17.3616, 78.4747, 1);
const B = mk("b", "Golconda Fort", 17.3833, 78.4011, 2);
const C = mk("c", "Durgam Cheruvu", 17.4319, 78.3878, 3);
const D = mk("d", "Shilparamam", 17.4526, 78.3816, 4);
const HERE = { lat: 17.37, lng: 78.48 };

describe("detectStopChange (pure)", () => {
  const refs = (...s: Stop[]) => s.map((x) => ({ id: x.id, name: x.name }));
  const ids = (...s: Stop[]) => new Set(s.map((x) => x.id));
  it("the stop being driven to was deleted → the next remaining stop, with a message naming it", () => {
    const c = detectStopChange({ before: refs(A, B, C), after: refs(B, C), existingIds: ids(B, C) });
    expect(c).toEqual({ kind: "target-removed", removed: { id: "a", name: "Charminar" }, next: { id: "b", name: "Golconda Fort" } });
    expect(stopChangeMessage(c)).toBe("A stop was removed. Going to Golconda Fort now.");
  });
  it("the next stop was deleted too → goes to the first one still left", () => {
    const c = detectStopChange({ before: refs(A, B, C), after: refs(C), existingIds: ids(C) });
    expect(c).toMatchObject({ kind: "target-removed", next: { id: "c" } });
    expect(stopChangeMessage(c)).toBe("A stop was removed. Going to Durgam Cheruvu now.");
  });
  it("a later stop was deleted → same target, no message", () => {
    const c = detectStopChange({ before: refs(A, B, C), after: refs(A, C), existingIds: ids(A, C) });
    expect(c).toEqual({ kind: "later-removed", removed: [{ id: "b", name: "Golconda Fort" }] });
    expect(stopChangeMessage(c)).toBeNull();
  });
  it("the last stop was deleted → a clear 'no more stops'", () => {
    const c = detectStopChange({ before: refs(A), after: [], existingIds: new Set() });
    expect(stopChangeMessage(c)).toBe("A stop was removed. There are no more stops today.");
  });
  it("finishing, skipping or moving a stop is NOT a removal (it still exists)", () => {
    expect(detectStopChange({ before: refs(A, B), after: refs(B), existingIds: ids(A, B) })).toEqual({ kind: "none" });
  });
  it("the trip's destination is never reported as a deleted stop", () => {
    expect(detectStopChange({ before: [{ id: "__destination__", name: "Vizag" }], after: [], existingIds: new Set() })).toEqual({ kind: "none" });
  });
  it("routeMatchesTargets: only a route for exactly these stops, in this order", () => {
    expect(routeMatchesTargets(["a", "b"], ["a", "b"], 8)).toBe(true);
    expect(routeMatchesTargets(["a", "b"], ["b"], 8)).toBe(false);
    expect(routeMatchesTargets(["a", "b"], ["a", "c"], 8)).toBe(false);
    expect(routeMatchesTargets(["a"], ["a", "b"], 1)).toBe(true);
    expect(routeMatchesTargets(null, [], 8)).toBe(false);
  });
  it("stopsSignature notices add / delete / status / order, not row order", () => {
    const s = stopsSignature([A, B]);
    expect(stopsSignature([B, A])).toBe(s);
    expect(stopsSignature([A])).not.toBe(s);
    expect(stopsSignature([A, { ...B, status: "done" }])).not.toBe(s);
    expect(stopsSignature([A, { ...B, sequence_order: 9 }])).not.toBe(s);
  });
  it("remembered targets expire and ignore junk", () => {
    const raw = encodeRemembered([{ id: "a", name: "Charminar" }], 1_000);
    expect(decodeRemembered(raw, 2_000)).toEqual([{ id: "a", name: "Charminar" }]);
    expect(decodeRemembered(raw, 1_000 + REMEMBER_MS + 1)).toBeNull();
    expect(decodeRemembered("{not json", 0)).toBeNull();
    expect(decodeRemembered(JSON.stringify({ v: 1, at: 0, targets: [{ id: 5 }] }), 0)).toBeNull();
  });
});

// ── The live composition: targets from the stops (as useTripLive does), the removal notice, and the REAL navigation hook ──
function osrmBody(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const n = 30;
  const line = Array.from({ length: n }, (_, i) => [from.lng + ((to.lng - from.lng) * i) / (n - 1), from.lat + ((to.lat - from.lat) * i) / (n - 1)]);
  const m = haversineM(from, to) * 1.2;
  const step = (frac: number, type: string, dist: number) => ({ distance: dist, duration: dist / 15, name: "Road", maneuver: { location: [from.lng + (to.lng - from.lng) * frac, from.lat + (to.lat - from.lat) * frac], bearing_after: 90, type } });
  const routes = parseOsrmDirections({ code: "Ok", routes: [{ distance: m, duration: m / 15, geometry: { coordinates: line }, legs: [{ steps: [step(0, "depart", m), step(1, "arrive", 0)] }] }] })!;
  return { routes, choices: describeRoutes(routes), notes: [] };
}

let calls: { to: { lat: number; lng: number } }[];
let store: Record<string, string>;
beforeEach(() => {
  calls = []; store = {};
  rt.listeners = []; rt.rows = []; rt.error = null; rt.queries = [];
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { from: { lat: number; lng: number }; to: { lat: number; lng: number } };
    calls.push({ to: body.to });
    return { ok: true, status: 200, json: async () => osrmBody(body.from, body.to) };
  }));
  vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } }, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => vi.unstubAllGlobals());

let nav!: Navigation;
let removal!: ReturnType<typeof useStopRemoved>;
let fixRef!: MutableRefObject<((m: Me) => void) | null>;
function Live({ places, driving = true }: { places: Stop[]; driving?: boolean }) {
  const ref = useRef<((m: Me) => void) | null>(null);
  // eslint-disable-next-line react-hooks/globals -- test harness
  fixRef = ref;
  const remaining = places.filter((p) => p.status === "planned").sort((a, b) => a.sequence_order - b.sequence_order);
  const targets = useMemo(() => planDriveTargets({ remaining, destination: { lat: null, lng: null, name: null }, driveDay: 1, numDays: 2, scheduledStopCount: places.length }), [places]); // eslint-disable-line react-hooks/exhaustive-deps
  const existing = useMemo(() => new Set(places.map((p) => p.id)), [places]);
  const refs = useMemo(() => targets.map((t) => ({ id: t.id, name: t.name })), [targets]);
  // eslint-disable-next-line react-hooks/globals -- test harness
  removal = useStopRemoved({ tripId: "trip", userId: "u1", targets: refs, existingIds: existing, remember: driving });
  const target = targets[0] ? { id: targets[0].id, name: targets[0].name, lat: targets[0].lat, lng: targets[0].lng } : null;
  // eslint-disable-next-line react-hooks/globals -- test harness
  nav = useNavigation({ target, ready: true, fixRef: ref });
  return null;
}
let t0 = 1_800_000_000_000;
let r: TestRenderer.ReactTestRenderer;
afterEach(() => { act(() => r?.unmount()); });
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((res) => setTimeout(res, 0)); });
const fix = async () => { t0 += 2000; await act(async () => { fixRef.current?.({ ...HERE, heading: null, speedKmh: 40, accuracyM: 8, at: t0, fixAt: t0 }); }); await flush(); };
const show = async (places: Stop[], driving = true) => {
  if (!r) { await act(async () => { r = TestRenderer.create(createElement(Live, { places, driving })); }); }
  else await act(async () => { r.update(createElement(Live, { places, driving })); });
  await flush();
};
const startDriving = async (places: Stop[]) => {
  r = undefined as unknown as TestRenderer.ReactTestRenderer;
  await show(places);
  act(() => nav.arm());
  await fix();
  expect(nav.phase).toBe("navigating");
};
const lastTo = () => calls.at(-1)?.to;

describe("deleting stops while driving (real navigation hook)", () => {
  it("delete the CURRENT target → next stop at once, re-routed there, with the message", async () => {
    await startDriving([A, B, C]);
    expect(nav.target?.id).toBe("a");
    await show([B, C]); // A deleted (here, or another member's delete reached this screen)
    expect(nav.target?.id).toBe("b");
    expect(lastTo()).toEqual({ lat: B.lat, lng: B.lng });
    expect(nav.phase).toBe("navigating");
    expect(removal.message).toBe("A stop was removed. Going to Golconda Fort now.");
  });

  it("the next stop is deleted too → the first stop still left", async () => {
    await startDriving([A, B, C, D]);
    await show([C, D]);
    expect(nav.target?.id).toBe("c");
    expect(lastTo()).toEqual({ lat: C.lat, lng: C.lng });
    expect(removal.message).toBe("A stop was removed. Going to Durgam Cheruvu now.");
    // …and then that one goes as well: on to the next.
    await show([D]);
    expect(nav.target?.id).toBe("d");
    expect(removal.message).toBe("A stop was removed. Going to Shilparamam now.");
  });

  it("delete a LATER stop → same target, no interruption, no message", async () => {
    await startDriving([A, B, C]);
    const before = calls.length;
    await show([A, C]);
    expect(nav.target?.id).toBe("a");
    expect(nav.phase).toBe("navigating");
    expect(calls.length).toBe(before); // the road to the current stop is unchanged
    expect(removal.message).toBeNull();
  });

  it("delete the LAST stop → 'no more stops', no target, no old route", async () => {
    await startDriving([A]);
    await show([]);
    expect(nav.target).toBeNull();
    expect(nav.routes).toEqual([]);
    expect(nav.phase).not.toBe("navigating");
    expect(removal.message).toBe("A stop was removed. There are no more stops today.");
  });

  it("done and skipped stops are never the target, and give no 'removed' message", async () => {
    await startDriving([A, B, C]);
    await show([{ ...A, status: "done" }, { ...B, status: "skipped" }, C]);
    expect(nav.target?.id).toBe("c");
    expect(removal.message).toBeNull();
  });

  it("another member deleted it while this phone was asleep and the page reloaded → the message still shows", async () => {
    await startDriving([A, B, C]);
    expect(decodeRemembered(store[rememberKey("u1", "trip")], Date.now())?.map((t) => t.id)).toEqual(["a", "b", "c"]);
    act(() => r.unmount());
    r = undefined as unknown as TestRenderer.ReactTestRenderer;
    await show([B, C]); // fresh page, fresh data: A is gone
    expect(nav.target?.id).toBe("b");
    expect(removal.message).toBe("A stop was removed. Going to Golconda Fort now.");
  });
});

describe("never 'you've arrived' at a deleted stop", () => {
  const T = 1_800_000_000_000; const M = 111_195;
  const stop = (o: Partial<ArrivalStop> = {}): ArrivalStop => ({ id: "s1", name: "Bhongir Fort", lat: 17.5126, lng: 78.8886, category: "temple", status: "planned", order: 1, ...o });
  let api!: ReturnType<typeof useArrival>; let now = T;
  const holder: { ref: MutableRefObject<((m: Me) => void) | null> } = { ref: { current: null } };
  const Inner = ({ stops }: { stops: ArrivalStop[] }) => {
    // eslint-disable-next-line react-hooks/globals -- test harness
    api = useArrival({ tripId: "t1", userId: "u1", stops, enabled: true, session: 1, arrivalRef: holder.ref, mark: async () => "saved" });
    return null;
  };
  it("the prompt disappears when its stop is deleted", async () => {
    vi.useFakeTimers(); vi.setSystemTime(T);
    try {
      let rr!: TestRenderer.ReactTestRenderer;
      await act(async () => { rr = TestRenderer.create(createElement(Inner, { stops: [stop(), stop({ id: "s2", name: "Yadagirigutta", lat: 17.59, order: 2 })] })); });
      const feed = async (after: number) => { now += after * 1000; vi.setSystemTime(now); await act(async () => { holder.ref.current?.({ lat: 17.5126 + 30 / M, lng: 78.8886, heading: null, speedKmh: 2, accuracyM: 20, at: now, fixAt: now }); }); };
      await feed(0); await feed(25); await feed(10);
      expect(api.prompt?.stopId).toBe("s1");
      await act(async () => { rr.update(createElement(Inner, { stops: [stop({ id: "s2", name: "Yadagirigutta", lat: 17.59, order: 1 })] })); });
      expect(api.prompt).toBeNull();
      act(() => rr.unmount());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useTripChanges: other members' changes reach an open screen", () => {
  let changes: number; let docListeners: Record<string, (() => void)[]>; let online: boolean;
  const Probe = ({ places, driving }: { places: Stop[]; driving: boolean }) => { useTripChanges({ tripId: "trip", places, driving, onChange: () => { changes++; } }); return null; };
  let rr: TestRenderer.ReactTestRenderer;
  beforeEach(() => {
    vi.useFakeTimers();
    changes = 0; docListeners = {}; online = true;
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: (n: string, f: () => void) => { (docListeners[n] ??= []).push(f); }, removeEventListener() {} });
    vi.stubGlobal("navigator", { get onLine() { return online; } });
  });
  afterEach(() => { act(() => rr?.unmount()); vi.useRealTimers(); });
  const mount = (places: Stop[], driving: boolean) => act(() => { rr = TestRenderer.create(createElement(Probe, { places, driving })); });
  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it("the 'stops changed' hint (sent after a delete) reloads once, even for a burst", async () => {
    mount([A, B], false);
    const hint = rt.listeners.find((l) => l.kind === "broadcast")!;
    act(() => { hint.cb(); hint.cb(); hint.cb(); });
    await tick(700);
    expect(changes).toBe(1);
  });
  it("back from sleep: a light check reloads only when the stops really differ", async () => {
    mount([A, B], false);
    rt.rows = [A, B];
    await act(async () => { docListeners.visibilitychange.forEach((f) => f()); });
    await tick(0);
    expect(changes).toBe(0);
    rt.rows = [B]; // A was deleted elsewhere
    await act(async () => { docListeners.visibilitychange.forEach((f) => f()); });
    await tick(0);
    expect(changes).toBe(1);
    expect(rt.queries.at(-1)).toBe("id, status, day_number, sequence_order"); // light: 4 small columns
  });
  it("the 2-minute check runs ONLY while driving, and never while offline", async () => {
    rt.rows = [B];
    mount([A, B], false);
    await tick(DRIVE_CHECK_MS * 2);
    expect(rt.queries).toEqual([]);
    act(() => rr.unmount());
    mount([A, B], true);
    online = false;
    await tick(DRIVE_CHECK_MS);
    expect(rt.queries).toEqual([]);
    online = true;
    await tick(DRIVE_CHECK_MS);
    expect(rt.queries).toHaveLength(1);
    expect(changes).toBe(1);
  });
  it("a failed check never reloads", async () => {
    mount([A, B], true);
    rt.rows = []; rt.error = { message: "503" };
    await tick(DRIVE_CHECK_MS);
    expect(changes).toBe(0);
  });
});

// ── Server: deleting a stop clears the NEXT stop's saved leg (it was measured from the deleted stop) ──
const server = { client: null as unknown, updates: [] as { values: unknown; id: unknown }[] };
describe("DELETE /api/places/[id]", () => {
  const ID = "22222222-0000-4000-8000-000000000001";
  const setup = (deleted: Record<string, unknown> | null, nextId: string | null) => {
    server.updates = [];
    server.client = {
      auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
      from: () => {
        let mode = "";
        let values: unknown = null;
        const q: Record<string, unknown> = {};
        Object.assign(q, {
          delete: () => { mode = "delete"; return q; },
          update: (v: unknown) => { mode = "update"; values = v; return q; },
          select: () => { if (!mode) mode = "select"; return q; },
          eq: (col: string, v: unknown) => { if (mode === "update" && col === "id") server.updates.push({ values, id: v }); return q; },
          gt: () => q, order: () => q, limit: () => q,
          then: (res: (v: unknown) => unknown) => res(mode === "delete" ? { data: deleted ? [deleted] : [], error: null } : mode === "select" ? { data: nextId ? [{ id: nextId }] : [], error: null } : { data: null, error: null }),
        });
        return q;
      },
    };
  };
  const call = () => deletePlace(new Request(`https://x/api/places/${ID}`, { method: "DELETE" }), { params: Promise.resolve({ id: ID }) });

  it("clears the following stop's km/minutes, so the old leg through the deleted stop is never shown", async () => {
    setup({ id: ID, trip_id: "t", day_number: 1, sequence_order: 2 }, "next-stop");
    const res = await call();
    expect(res.status).toBe(200);
    expect(server.updates).toEqual([{ values: { drive_km: null, drive_minutes: null }, id: "next-stop" }]);
  });
  it("an idea (no day) or the last stop of a day changes nothing else", async () => {
    setup({ id: ID, trip_id: "t", day_number: null, sequence_order: null }, "x");
    await call();
    setup({ id: ID, trip_id: "t", day_number: 1, sequence_order: 5 }, null);
    await call();
    expect(server.updates).toEqual([]);
  });
  it("a stop you may not delete is still a 404", async () => {
    setup(null, null);
    expect((await call()).status).toBe(404);
  });
});

describe("the 'no more stops' panel", () => {
  it("driving with nothing left says so plainly and links to the plan — never an empty destination", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { NavigationPanel } = await import("@/components/map/NavigationOverlay");
    const ui = { nav: { target: null, phase: "idle" }, noMoreStops: { planHref: "/trips/t/plan" } } as unknown as Parameters<typeof NavigationPanel>[0]["ui"];
    const html = renderToStaticMarkup(createElement(NavigationPanel, { ui, floating: false }));
    expect(html).toContain("No more stops today");
    expect(html).toContain('href="/trips/t/plan"');
    const none = { ...ui, noMoreStops: null } as typeof ui;
    expect(renderToStaticMarkup(createElement(NavigationPanel, { ui: none, floating: false }))).toBe("");
  });
});
