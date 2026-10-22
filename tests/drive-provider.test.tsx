// The app-wide drive: survives leaving the page, one drive at a time, "Driving to …" bar, restore after reload, and the ways it ends.
// The engine itself is replaced by a small stand-in (its own behaviour is tested elsewhere); everything else here is real.
import { createElement, act, type ReactNode } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripData } from "@/lib/client/trip-bundle";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const T0 = 1_800_000_000_000;

const h = vi.hoisted(() => ({
  pathname: "/trips/A/map",
  engines: [] as { tripId: string; mountedAt: number; props: Record<string, unknown> }[],
  mounts: 0,
  stops: [] as string[],
  loads: [] as string[],
  deletes: [] as string[],
  watchers: [] as string[],
  confirms: [] as string[], alerts: [] as string[], confirmAnswer: true, shares: [] as string[],
  loadFail: 0,
}));
vi.mock("next/navigation", () => ({ usePathname: () => h.pathname, useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/components/TripGoneWatcher", () => ({ TripGoneWatcher: ({ tripId }: { tripId: string }) => { h.watchers.push(tripId); return createElement("i", { "data-watcher": tripId }); } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: (t: string) => ({ delete: () => ({ eq: (_a: string, trip: string) => ({ eq: async () => { h.deletes.push(`${t}:${trip}`); return {}; } }) }) }) }) }));
vi.mock("@/lib/client/trip-bundle", () => ({ loadTripData: async (tripId: string, userId: string) => { h.loads.push(tripId); if (h.loadFail > 0) { h.loadFail--; return { ok: false, reason: "error" }; } return { ok: true, data: dataFor(tripId, userId) }; } }));
// A stand-in engine with the same contract: it publishes a value, and reports starts and ends.
vi.mock("@/components/drive/DriveEngine", async () => {
  const React = await import("react");
  return {
    DriveEngine: (p: { data: TripData; restore: unknown; canSave?: boolean; guardStart?: () => boolean; onValue: (e: unknown) => void; onDriveStart: (id: string, name: string) => void; onDriveEnd: (id: string, why: string) => void }) => {
      const [active, setActive] = React.useState(!!(p.restore as { resumeGps?: boolean } | null)?.resumeGps);
      const [mountedAt] = React.useState(() => ++h.mounts);
      const tripId = p.data.trip.id;
      React.useEffect(() => { h.engines.push({ tripId, mountedAt, props: p as never }); });
      const value = {
        tripId, paused: !!p.restore && !(p.restore as { resumeGps: boolean }).resumeGps, ui: { page: "map" }, alerts: { active: [] },
        live: {
          nextTarget: { id: "s1", name: `Stop of ${tripId}` }, distanceLeft: null,
          drive: {
            active, share: true, setShare: (v: boolean, o?: { keepRow?: boolean }) => { h.shares.push(`${v}:${o?.keepRow ? "keep" : "drop"}`); },
            start: () => { if (p.guardStart && !p.guardStart()) return; setActive(true); p.onDriveStart(tripId, p.data.trip.name); },
            stop: () => { h.stops.push(tripId); setActive(false); p.onDriveEnd(tripId, "stopped"); },
          },
        },
      };
      React.useEffect(() => { p.onValue(value); });
      React.useEffect(() => () => p.onValue(null), []); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    },
  };
});
import { DriveProvider, useTripEngine, type TripEngineView } from "@/components/drive/DriveProvider";
import { DRIVE_SIGN_OUT_EVENT, DEFAULT_UI, NO_GPS_EXPIRY_MS, writeDrive } from "@/lib/drive/persist";
import { TRIP_GONE_EVENT } from "@/lib/trip/deletion";

function dataFor(tripId: string, userId = "u1"): TripData {
  return { trip: { id: tripId, name: `Trip ${tripId}` } as never, places: [], members: [], votes: {}, conditions: {}, userId, today: "2026-10-18" };
}

// ── A fake browser: storage, window events, permissions and Web Locks ──
let store: Map<string, string>; let perm: "granted" | "prompt"; let lockTaken: boolean;
beforeEach(() => {
  h.pathname = "/trips/A/map"; h.engines = []; h.mounts = 0; h.stops = []; h.loads = []; h.deletes = []; h.watchers = []; h.loadFail = 0;
  h.confirms = []; h.alerts = []; h.confirmAnswer = true; h.shares = [];
  store = new Map(); perm = "granted"; lockTaken = false;
  const target = new EventTarget();
  vi.stubGlobal("window", Object.assign(target, {
    confirm: (m: string) => { h.confirms.push(m); return h.confirmAnswer; }, alert: (m: string) => { h.alerts.push(m); },
    localStorage: { get length() { return store.size; }, key: (i: number) => [...store.keys()][i] ?? null, getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } },
  }));
  vi.stubGlobal("navigator", {
    permissions: { query: async () => ({ state: perm }) },
    locks: { request: (_n: string, _o: unknown, cb: (l: unknown) => unknown) => { if (lockTaken) { void cb(null); return Promise.resolve(); } lockTaken = true; return Promise.resolve(cb({})).then(() => { lockTaken = false; }); } },
    onLine: true,
  });
  vi.spyOn(Date, "now").mockReturnValue(T0);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

let view: TripEngineView | null;
function Page({ tripId }: { tripId: string }) {
  // eslint-disable-next-line react-hooks/globals -- test harness: expose what the page sees
  view = useTripEngine(dataByTrip[tripId] ??= dataFor(tripId), () => {}, "map");
  return null;
}
const dataByTrip: Record<string, TripData> = {};
let r: TestRenderer.ReactTestRenderer;
const tree = (page: string | null) => <DriveProvider userId="u1">{page ? <Page tripId={page} /> : <p>Discover</p>}</DriveProvider>;
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const mount = async (page: string | null) => { await act(async () => { r = TestRenderer.create(tree(page)); }); await settle(); };
const go = async (page: string | null, path: string) => { h.pathname = path; await act(async () => { r.update(tree(page)); }); await settle(); };
const bar = () => r.root.findAll((n) => n.props["data-testid"] === "drive-bar")[0] ?? null;
const text = (n: unknown): string => { const j = n as { children?: unknown[] } | string | null; return j == null ? "" : typeof j === "string" ? j : (j.children ?? []).map(text).join(""); };
const engineOf = () => (view?.status === "ready" ? view.engine : null) as unknown as { tripId: string; live: { drive: { active: boolean; start: () => void; stop: () => void } } } | null;
const start = async () => { await act(async () => { engineOf()!.live.drive.start(); }); await settle(); };
afterEach(() => { act(() => r?.unmount()); for (const k of Object.keys(dataByTrip)) delete dataByTrip[k]; });

describe("the drive survives moving around the app", () => {
  it("not driving: the trip's page gets its drive engine, and leaving the trip lets it go", async () => {
    await mount("A");
    expect(view?.status).toBe("ready"); expect(h.engines.at(-1)?.tripId).toBe("A");
    await go(null, "/discover");
    expect(r.root.findAll((n) => n.props["data-testid"] === "drive-bar")).toHaveLength(0);
  });
  it("driving: going to Discover keeps the SAME engine running (nothing restarts), and the bar takes you back in one tap", async () => {
    await mount("A"); await start();
    const first = h.engines.at(-1)!.mountedAt;
    await go(null, "/discover");
    expect(h.engines.at(-1)!.mountedAt).toBe(first); // not remounted
    expect(h.stops).toEqual([]);
    const b = bar(); expect(b).not.toBeNull();
    expect(text(b.children[0])).toContain("Driving to Stop of A");
    expect(b.findByType("a").props.href).toBe("/trips/A/map");
    await go("A", "/trips/A/map");
    expect(h.engines.at(-1)!.mountedAt).toBe(first);
    expect(engineOf()?.live.drive.active).toBe(true);
  });
  it("the bar is not shown on the drive's own map and live screens, but is on the trip's other pages", async () => {
    await mount("A"); await start();
    expect(bar()).toBeNull();
    await go("A", "/trips/A/live"); expect(bar()).toBeNull();
    await go(null, "/trips/A/plan"); expect(bar()).not.toBeNull();
  });
  it("away from the trip's pages, the drive still watches for the trip being deleted or the traveller removed", async () => {
    await mount("A"); await start();
    expect(r.root.findAll((n) => n.props["data-watcher"] === "A")).toHaveLength(0); // the trip layout has its own there
    await go(null, "/profile");
    expect(r.root.findAll((n) => n.props["data-watcher"] === "A")).toHaveLength(1);
  });
});

describe("one drive at a time", () => {
  it("another trip can still be looked at while driving; its Start asks first, and saying no changes nothing", async () => {
    await mount("A"); await start();
    await go("B", "/trips/B/map");
    expect(view?.status).toBe("ready"); expect(engineOf()?.tripId).toBe("B"); // B's map, to look at
    expect(text(bar())).toContain("Driving to Stop of A"); // and the bar still says where the drive goes
    h.confirmAnswer = false;
    await start();
    expect(h.confirms[0]).toMatch(/^You're driving Trip A \(next: Stop of A\)\. End that drive and start driving Trip B\?$/);
    expect(h.stops).toEqual([]); expect(engineOf()?.live.drive.active).toBe(false);
  });
  it("saying yes ends the old drive and starts the new one", async () => {
    await mount("A"); await start();
    await go("B", "/trips/B/map");
    await start();
    expect(h.stops).toEqual(["A"]); expect(engineOf()?.live.drive.active).toBe(true);
    await go(null, "/discover");
    expect(text(bar())).toContain("Driving to Stop of B");
  });
  it("the same trip never asks", async () => {
    await mount("A"); await start();
    expect(h.confirms).toEqual([]);
  });
  it("a second tab does not run the drive: it says where it runs, and Start there explains instead of starting", async () => {
    lockTaken = true; // another tab holds the drive
    writeDrive(window.localStorage, { v: 1, userId: "u1", tripId: "A", tripName: "Trip A", savedAt: T0, startedAt: T0, lastFixAt: T0, session: 2, confirmedSession: 2, share: true, nav: null, driveRoute: null, cued: [], next: { id: "s1", name: "Fort" }, ui: DEFAULT_UI });
    h.pathname = "/discover";
    await mount(null);
    expect(h.engines).toHaveLength(0);
    expect(text(bar())).toContain("running in another Trailmate tab");
    await go("A", "/trips/A/map");
    expect(view?.status).toBe("ready"); // the trip can be looked at
    await start();
    expect(h.alerts[0]).toContain("running in another Trailmate tab"); expect(engineOf()?.live.drive.active).toBe(false);
  });
  it("a tab that loses the race for the drive saves nothing and names the OTHER tab's trip", async () => {
    // This tab opened trip X before another tab started driving A: it does not know yet.
    await mount("X");
    expect(h.engines.at(-1)?.props.canSave).toBe(false);
    writeDrive(window.localStorage, { v: 1, userId: "u1", tripId: "A", tripName: "Trip A", savedAt: T0, startedAt: T0, lastFixAt: T0, session: 2, confirmedSession: 2, share: true, nav: null, driveRoute: null, cued: [], next: null, ui: DEFAULT_UI });
    lockTaken = true;
    await start();
    expect(h.stops).toEqual(["X"]); // its own copy stopped…
    expect(h.shares).toEqual(["false:keep"]); // …without removing the location the other tab is publishing
    expect(store.get("tm:drive-active:u1")).toBe("A"); expect(store.has("tm:drive:u1:A")).toBe(true); // …and the other tab's drive untouched
    await go(null, "/discover");
    expect(text(bar())).toContain("Your drive (Trip A) is running in another Trailmate tab");
  });
  it("when the other tab FINISHES its drive, this tab is free again and does not sit on the lock", async () => {
    lockTaken = true;
    writeDrive(window.localStorage, { v: 1, userId: "u1", tripId: "A", tripName: "Trip A", savedAt: T0, startedAt: T0, lastFixAt: T0, session: 2, confirmedSession: 2, share: true, nav: null, driveRoute: null, cued: [], next: null, ui: DEFAULT_UI });
    h.pathname = "/discover";
    await mount(null);
    expect(text(bar())).toContain("another Trailmate tab");
    store.clear(); lockTaken = false; // the other tab tapped Finish
    await act(async () => { window.dispatchEvent(new Event("storage")); }); await settle();
    expect(bar()).toBeNull();
    expect(lockTaken).toBe(false); // nobody holds it: either tab can start the next drive
  });
  it("when the tab that ran the drive is closed, this one takes it over", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      lockTaken = true;
      writeDrive(window.localStorage, { v: 1, userId: "u1", tripId: "A", tripName: "Trip A", savedAt: T0, startedAt: T0, lastFixAt: T0, session: 2, confirmedSession: 2, share: true, nav: null, driveRoute: null, cued: [], next: null, ui: DEFAULT_UI });
      h.pathname = "/discover";
      await mount(null);
      expect(h.engines).toHaveLength(0);
      lockTaken = false; // the other tab was closed: the browser released its lock
      await act(async () => { vi.advanceTimersByTime(4_000); }); await settle();
      expect(h.engines.at(-1)?.tripId).toBe("A");
      expect(h.engines.at(-1)?.props.restore).toMatchObject({ snapshot: { session: 2 } });
      expect(text(bar())).toContain("Driving to Stop of A");
    } finally { vi.useRealTimers(); }
  });
  it("the tab running the drive leaves a short note as it unloads; getting the lock back clears it", async () => {
    await mount("A"); await start();
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    expect(store.get("tm:drive-handoff:u1")).toBe(String(T0));
    writeDrive(window.localStorage, { v: 1, userId: "u1", tripId: "A", tripName: "Trip A", savedAt: T0, startedAt: T0, lastFixAt: T0, session: 2, confirmedSession: 2, share: true, nav: null, driveRoute: null, cued: [], next: null, ui: DEFAULT_UI });
    act(() => r.unmount()); lockTaken = false; // the reload released the lock…
    await mount("A"); // …and the reloaded tab took it back
    expect(store.has("tm:drive-handoff:u1")).toBe(false);
    expect(h.engines.at(-1)?.props.canSave).toBe(true);
  });
  it("a tab that is not driving leaves no note", async () => {
    await mount("A");
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    expect(store.has("tm:drive-handoff:u1")).toBe(false);
  });
  it("while the driving tab RELOADS, a hidden second tab does not grab the drive; it takes over only if that tab never comes back", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      lockTaken = true;
      writeDrive(window.localStorage, { v: 1, userId: "u1", tripId: "A", tripName: "Trip A", savedAt: T0, startedAt: T0, lastFixAt: T0, session: 2, confirmedSession: 2, share: true, nav: null, driveRoute: null, cued: [], next: null, ui: DEFAULT_UI });
      h.pathname = "/discover";
      await mount(null);
      // The driving tab reloads: it leaves its note and its lock is released for a moment.
      store.set("tm:drive-handoff:u1", String(T0)); lockTaken = false;
      await act(async () => { vi.advanceTimersByTime(4_000); }); await settle();
      expect(h.engines).toHaveLength(0); expect(lockTaken).toBe(false); // the lock is left free for the reloading tab
      await act(async () => { vi.advanceTimersByTime(4_000); }); await settle();
      expect(h.engines).toHaveLength(0);
      // It never came back (it was closed, not reloaded): once the note is stale, this tab carries on the drive.
      vi.mocked(Date.now).mockReturnValue(T0 + 12_000);
      await act(async () => { vi.advanceTimersByTime(4_000); }); await settle();
      expect(h.engines.at(-1)?.tripId).toBe("A");
      expect(h.engines.at(-1)?.props.restore).toMatchObject({ snapshot: { session: 2 } });
      expect(store.has("tm:drive-handoff:u1")).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});

describe("after a reload", () => {
  const saved = (o: Record<string, unknown> = {}) => writeDrive(window.localStorage, { v: 1, userId: "u1", tripId: "A", tripName: "Trip A", savedAt: T0, startedAt: T0, lastFixAt: T0, session: 2, confirmedSession: 2, share: true, nav: null, driveRoute: null, cued: [], next: { id: "s1", name: "Fort" }, ui: DEFAULT_UI, ...o } as never);
  it("location allowed: the drive carries on at once, even on another page (its data is loaded in the browser)", async () => {
    saved(); h.pathname = "/discover";
    await mount(null);
    expect(h.loads).toEqual(["A"]);
    expect(h.engines.at(-1)?.tripId).toBe("A");
    expect(h.engines.at(-1)?.props.restore).toMatchObject({ resumeGps: true, snapshot: { session: 2 } });
    expect(text(bar())).toContain("Driving to Stop of A");
  });
  it("location not allowed yet: the drive waits for one tap (Resume on the bar)", async () => {
    perm = "prompt"; saved(); h.pathname = "/discover";
    await mount(null);
    expect(h.engines.at(-1)?.props.restore).toMatchObject({ resumeGps: false });
    expect(text(bar())).toContain("Drive paused");
  });
  it("reloading ON the trip's own map: the page's data is used (no second load) AND the saved drive reaches the engine", async () => {
    saved();
    await mount("A");
    expect(h.loads).toEqual([]);
    expect(view?.status).toBe("ready");
    expect(h.engines.every((e) => e.props.restore !== null)).toBe(true); // the engine never started without its saved state
    expect(h.engines.at(-1)?.props.restore).toMatchObject({ resumeGps: true, snapshot: { session: 2 } });
    expect(engineOf()?.live.drive.active).toBe(true);
  });
  it("no signal to load the trip after a reload: the bar says so, and it keeps trying until it can", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      saved(); h.pathname = "/discover"; h.loadFail = 2;
      await mount(null);
      expect(h.engines).toHaveLength(0);
      expect(text(bar())).toContain("Reconnecting");
      await act(async () => { vi.advanceTimersByTime(3_000); }); await settle();
      await act(async () => { vi.advanceTimersByTime(10_000); }); await settle();
      expect(h.loads).toHaveLength(3);
      expect(h.engines.at(-1)?.tripId).toBe("A");
      expect(text(bar())).not.toContain("Reconnecting");
    } finally { vi.useRealTimers(); }
  });
  it("a drive left for hours without GPS is not resumed, and the app says why once", async () => {
    saved({ lastFixAt: T0 - NO_GPS_EXPIRY_MS - 1 });
    await mount(null);
    expect(h.engines).toHaveLength(0);
    expect(text(bar())).toContain("no GPS position for 3 hours");
    expect(store.size).toBe(0);
  });
  it("another person's saved drive on this phone is never resumed", async () => {
    writeDrive(window.localStorage, { v: 1, userId: "u2", tripId: "A", tripName: "Trip A", savedAt: T0, startedAt: T0, lastFixAt: T0, session: 2, confirmedSession: 2, share: true, nav: null, driveRoute: null, cued: [], next: null, ui: DEFAULT_UI });
    await mount(null);
    expect(h.engines).toHaveLength(0); expect(bar()).toBeNull();
  });
});

describe("how it ends", () => {
  it("Stop / Finish: the drive and its saved state are gone", async () => {
    await mount("A"); await start();
    store.set("tm:drive:u1:A", "{}"); store.set("tm:drive-active:u1", "A");
    await act(async () => { (engineOf() as unknown as { live: { drive: { stop: () => void } } }).live.drive.stop(); }); await settle();
    await go(null, "/discover");
    expect(bar()).toBeNull(); expect(store.has("tm:drive:u1:A")).toBe(false); expect(store.has("tm:drive-active:u1")).toBe(false);
  });
  it("the trip was deleted, or I was removed: the drive ends and nothing of it stays", async () => {
    await mount("A"); await start(); await go(null, "/discover");
    store.set("tm:drive:u1:A", "{}"); store.set("tm:drive-active:u1", "A");
    await act(async () => { window.dispatchEvent(new CustomEvent(TRIP_GONE_EVENT, { detail: { tripId: "A" } })); }); await settle();
    expect(bar()).toBeNull(); expect(store.size).toBe(0);
  });
  it("sign-out in ANOTHER tab of this browser ends this tab's drive too", async () => {
    await mount("A"); await start();
    store.set("tm:drive:u1:A", "{}");
    const ev = Object.assign(new Event("storage"), { key: "tm:drive-signout", newValue: `u1:${T0}` });
    await act(async () => { window.dispatchEvent(ev); }); await settle();
    expect(h.stops).toEqual(["A"]); expect(store.has("tm:drive:u1:A")).toBe(false);
  });
  it("another person signing out elsewhere does not touch this drive", async () => {
    await mount("A"); await start();
    const ev = Object.assign(new Event("storage"), { key: "tm:drive-signout", newValue: `u2:${T0}` });
    await act(async () => { window.dispatchEvent(ev); }); await settle();
    expect(h.stops).toEqual([]);
  });
  it("sign-out: sharing stops while still signed in, the drive stops, and this person's drive data is wiped", async () => {
    await mount("A"); await start();
    store.set("tm:drive:u1:A", "{}"); store.set("tm:arrival:u1:A", "{}"); store.set("tm:drive:u2:A", "{}");
    await act(async () => { window.dispatchEvent(new CustomEvent(DRIVE_SIGN_OUT_EVENT, { detail: { userId: "u1" } })); }); await settle();
    expect(h.deletes).toEqual(["live_locations:A"]); expect(h.stops).toEqual(["A"]);
    expect([...store.keys()]).toEqual(["tm:drive:u2:A"]);
  });
});
