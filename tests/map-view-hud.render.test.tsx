import { createElement, act, type ReactNode } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---- Everything MapView composes, replaced by small fakes so THIS test is about the layout and the rules, not the map engine --------------
const h = vi.hoisted(() => ({
  live: {} as Record<string, unknown>, tolls: {} as Record<string, unknown>, alerts: {} as { active: unknown[]; history: unknown[]; dismiss: (id: string) => void },
  mapProps: [] as Record<string, unknown>[],
}));
vi.mock("@/components/TripMapLazy", () => ({ TripMapLazy: (p: Record<string, unknown>) => { h.mapProps.push(p); return createElement("div", { "data-testid": "map" }); } }));
vi.mock("@/lib/client/use-trip-live", () => ({ useTripLive: () => h.live }));
vi.mock("@/lib/client/use-toll-watch", () => ({ useTollWatch: () => h.tolls }));
vi.mock("@/lib/client/use-alerts", () => ({ useAlerts: () => ({ ...h.alerts, notify: () => true, act: () => {} }) }));
vi.mock("@/lib/client/use-visits", () => ({ useVisits: () => ({ outbox: { items: [], send: async () => "saved", syncing: false, failed: null, clearFailed: () => {}, notice: null, clearNotice: () => {} }, mark: () => {}, failed: null, clearFailed: () => {}, syncing: false }) }));
vi.mock("@/lib/client/use-trip-actions", () => ({ useTripActions: () => ({ insertStop: () => {}, setStatus: async () => {}, undo: null, replanning: false, runUndo: async () => {}, dismissUndo: () => {} }) }));
vi.mock("@/lib/client/use-vehicle", () => ({ useVehicle: () => ["car", () => {}] }));
vi.mock("@/lib/client/use-map-theme", () => ({ useMapTheme: () => ["light", () => {}] }));
vi.mock("@/lib/client/use-nav-ui", () => ({ useNavUi: () => ({ nav: {}, ui: { onRecenter: () => {} }, navBusy: false, headingUp: true, viewRequest: null, recenter: null, onCompass: () => {} }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
// The drive is app-wide (components/drive). Here each page is rendered through the SAME engine hook, inline, so the page's real
// behaviour is tested without the provider around it.
vi.mock("@/components/drive/DriveProvider", async () => {
  const { useEngineValue } = await import("@/components/drive/DriveEngine");
  return { useTripEngine: (data: never, refresh: () => void) => ({ status: "ready", engine: useEngineValue({ data, restore: null, refresh, onDriveStart: () => {}, onDriveEnd: () => {} }) }) };
});
vi.mock("@/components/map/NavigationOverlay", () => ({ NavigationBanner: () => createElement("div", { "data-testid": "banner" }), NavigationPanel: () => createElement("div", { "data-testid": "panel" }) }));
vi.mock("@/components/LiveArrival", () => ({ LiveArrival: () => null }));
vi.mock("@/components/intel/UndoToast", () => ({ UndoToast: () => null }));
vi.mock("@/components/DriveGateCard", () => ({ DriveGateCard: () => null }));
vi.mock("@/components/intel/WeatherSunCard", () => ({ WeatherSunCard: () => null }));
vi.mock("@/components/intel/RadarList", () => ({ RadarList: () => null }));
vi.mock("@/components/intel/AheadBrowser", () => ({ AheadBrowser: () => null }));
vi.mock("@/components/VehicleSelector", () => ({ VehicleSelector: () => createElement("div", { "data-testid": "vehicle" }) }));
vi.mock("@/components/map/MapThemeControl", () => ({ MapThemeControl: () => createElement("div", { "data-testid": "theme" }) }));
import { MapView } from "@/components/MapView";

const text = (n: ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(text).join(""));
const trip = { id: "t1", name: "Trip", num_days: 1, start_date: null, start_lat: 17.4, start_lng: 78.4, start_city: "Hyderabad", dest_lat: 17.5, dest_lng: 78.5, dest_name: "Khairtabad" } as never;
const freshLive = () => ({
  liveMarkers: [], poiMarkers: [], driveDay: 1, todayDay: 1, overrun: false, liveOk: false, previewFrom: null, localDate: "2026-10-15", localTime: "10:00", timing: null, gate: { open: false },
  drive: { active: false, start: vi.fn(), stop: vi.fn(), error: null, locating: false, shareFailed: false, route: null, me: null },
  intel: { result: null, coverage: null, photos: {}, refresh: vi.fn() },
  navigation: { phase: "idle", choose: vi.fn(), retry: vi.fn(), routes: [], selectedId: null },
  sound: { on: true, toggle: vi.fn(), blocked: false },
  persistable: { confirmedSession: null, cued: () => [] },
});
const freshTolls = (o: Record<string, unknown> = {}) => ({ navigating: false, status: "idle", complete: true, unavailable: false, ahead: [], next: null, retry: vi.fn(), ...o });
const toll = (aheadM: number) => ({ id: "node/1", lat: 0, lng: 0, name: "Kothur Toll Plaza", ref: null, operator: null, fee: null, routeM: 1, offsetM: 1, aheadM });

describe("the live map: one top stack, a toolbar, full screen, and messages that do not pile up", () => {
  let r: TestRenderer.ReactTestRenderer; let root: { style: { overflow: string } }; let keys: ((e: { key: string }) => void)[]; let dismissed: string[];
  beforeEach(() => {
    h.live = freshLive(); h.tolls = freshTolls(); h.mapProps = []; dismissed = []; keys = [];
    h.alerts = { active: [], history: [], dismiss: (id: string) => { dismissed.push(id); } };
    root = { style: { overflow: "" } };
    vi.stubGlobal("document", { documentElement: Object.assign(root, { requestFullscreen: async () => {} }), fullscreenElement: null, exitFullscreen: async () => {}, addEventListener: (_: string, fn: (e: { key: string }) => void) => { keys.push(fn); }, removeEventListener: (_: string, fn: (e: { key: string }) => void) => { keys = keys.filter((k) => k !== fn); } });
  });
  afterEach(() => { act(() => r?.unmount()); vi.unstubAllGlobals(); });
  const mount = async () => { await act(async () => { r = TestRenderer.create(createElement(MapView, { trip, places: [], members: [], votes: {}, conditions: {}, userId: "u1", today: "2026-10-15" })); }); };
  const rerender = async () => { await act(async () => { r.update(createElement(MapView, { trip, places: [], members: [], votes: {}, conditions: {}, userId: "u1", today: "2026-10-15" })); }); };
  const main = () => r.root.findByType("main");
  const btn = (label: string) => r.root.findAll((n) => n.type === "button" && (n.props["aria-label"] === label || text(n).includes(label)))[0];
  const stacks = () => r.root.findAll((n) => n.type === "div" && String(n.props.className).includes("absolute left-0 top-0 z-30"));
  const all = () => JSON.stringify(r.toJSON());

  it("puts the turn banner, the controls and the messages into ONE stack in normal flow, so nothing can overlap (and respects the notch)", async () => {
    await mount();
    expect(stacks()).toHaveLength(1);
    const cls = String(stacks()[0].props.className);
    expect(cls).toContain("flex-col"); expect(cls).toContain("env(safe-area-inset-top)"); expect(cls).toContain("max-h-full"); expect(cls).toContain("overflow-y-auto");
    expect(stacks()[0].findAll((n) => n.props["data-testid"] === "banner")).toHaveLength(1);
    expect(all()).not.toContain("top-24"); expect(all()).not.toContain("top-16"); // the old free-floating offsets are gone
  });
  it("does not let the stack block the map: the stack ignores touches, only its content takes them", async () => {
    await mount(); const cls = String(stacks()[0].props.className); expect(cls).toContain("pointer-events-none"); expect(cls).toContain("[&>*]:pointer-events-auto");
  });
  it("keeps the essential drive controls visible, with 44 px targets: Start drive, then Stop drive while driving", async () => {
    await mount(); expect(btn("Start drive")).toBeTruthy(); expect(String(btn("Start drive").props.className)).toContain("min-h-11");
    (h.live.drive as { active: boolean }).active = true; await rerender();
    expect(btn("Stop drive")).toBeTruthy(); expect(btn("Start drive")).toBeUndefined();
  });
  it("Follow me appears only while driving and not following (it is what brings the map back to you)", async () => {
    (h.live.drive as { active: boolean }).active = true; await mount(); expect(btn("Follow me")).toBeUndefined();
    const onPan = h.mapProps.at(-1)?.onUserPan as () => void; await act(async () => { onPan(); }); expect(btn("Follow me")).toBeTruthy();
  });

  it("map options (layers, vehicle, style) start folded, so they take no room, and open on demand", async () => {
    await mount(); expect(r.root.findAll((n) => n.props["data-testid"] === "vehicle")).toHaveLength(0);
    const opt = btn("Map options"); expect(opt.props["aria-expanded"]).toBe(false);
    await act(async () => { opt.props.onClick(); });
    expect(r.root.findAll((n) => n.props["data-testid"] === "vehicle")).toHaveLength(1); expect(r.root.findAll((n) => n.props["data-testid"] === "theme")).toHaveLength(1);
    expect(text(r.root)).toContain("Radar"); expect(text(r.root)).toContain("All places ahead");
    await act(async () => { btn("Map options").props.onClick(); }); expect(r.root.findAll((n) => n.props["data-testid"] === "vehicle")).toHaveLength(0);
  });

  describe("full screen", () => {
    it("starts in the page, expands to a true near-full-screen layer, tells the map to resize, locks the page behind it, and restores everything", async () => {
      await mount();
      expect(String(main().props.className)).toContain("relative h-[calc(100dvh-15.5rem)]"); expect(h.mapProps.at(-1)?.layoutKey).toBe("page");
      await act(async () => { btn("Expand map to full screen").props.onClick(); });
      expect(String(main().props.className)).toContain("fixed inset-0 z-[60]"); expect(h.mapProps.at(-1)?.layoutKey).toBe("full"); expect(root.style.overflow).toBe("hidden");
      expect(btn("Exit full screen map").props["aria-pressed"]).toBe(true);
      await act(async () => { btn("Exit full screen map").props.onClick(); });
      expect(String(main().props.className)).toContain("relative"); expect(h.mapProps.at(-1)?.layoutKey).toBe("page"); expect(root.style.overflow).toBe("");
    });
    it("Escape leaves it; the map is not left locked", async () => {
      await mount(); await act(async () => { btn("Expand map to full screen").props.onClick(); });
      await act(async () => { keys.forEach((k) => k({ key: "Escape" })); });
      expect(String(main().props.className)).toContain("relative"); expect(root.style.overflow).toBe("");
    });
    it("sits above the page's own bars (the header is z-30, the bottom navigation z-40, the alert layer z-50)", async () => {
      await mount(); await act(async () => { btn("Expand map to full screen").props.onClick(); });
      expect(String(main().props.className)).toContain("z-[60]");
    });
    it("keeps the essentials in full screen: the turn banner, the toolbar, the bottom panel with End; and drops the radar sheet", async () => {
      await mount(); await act(async () => { btn("Expand map to full screen").props.onClick(); });
      expect(r.root.findAll((n) => n.props["data-testid"] === "banner")).toHaveLength(1);
      expect(r.root.findAll((n) => n.props["data-testid"] === "panel")).toHaveLength(1);
      expect(btn("Exit full screen map")).toBeTruthy(); expect(btn("Start drive")).toBeTruthy();
      const radar = r.root.findAll((n) => n.type === "div" && n.props.hidden !== undefined && String(n.props.className).includes("max-h-[55%]"))[0];
      expect(radar.props.hidden).toBe(true);
    });
    it("leaving the page while full screen gives the page its scrolling back", async () => {
      await mount(); await act(async () => { btn("Expand map to full screen").props.onClick(); });
      await act(async () => { r.unmount(); }); expect(root.style.overflow).toBe("");
    });
  });

  describe("tolls", () => {
    it("shows NO toll card, banner or label while navigating a route with nothing to say (no 'toll data unavailable' on the map)", async () => {
      h.tolls = freshTolls({ navigating: true, status: "loading" }); await mount();
      for (const status of ["loading", "ready", "error"]) { h.tolls = freshTolls({ navigating: true, status }); await rerender(); }
      const t = text(r.root); expect(t).not.toMatch(/toll/i); expect(t).not.toContain("Navigation isn't affected"); expect(t).not.toContain("Try again");
    });
    it("a plaza ahead shows ONE small chip with its measured distance, and opens the route info with the details", async () => {
      h.tolls = freshTolls({ navigating: true, status: "ready", ahead: [toll(4_800)], next: toll(4_800) }); await mount();
      expect(text(btn("Toll · 4.8 km"))).toContain("Toll · 4.8 km");
      expect(all()).not.toContain("Kothur Toll Plaza"); // not on the map until asked
      await act(async () => { btn("Toll · 4.8 km").props.onClick(); });
      expect(text(r.root)).toContain("Kothur Toll Plaza"); expect(text(r.root)).toContain("about 4.8 km ahead");
      expect(r.root.findAll((n) => n.props["data-testid"] === "panel")).toHaveLength(1); // the End/ETA panel is still there
    });
    it("a failed toll check is not announced on the map as a card: only a button (and one dismissible, self-clearing note)", async () => {
      h.tolls = freshTolls({ navigating: true, status: "error", unavailable: true }); await mount();
      expect(btn("Route info")).toBeTruthy(); expect(r.root.findAll((n) => n.props.role === "dialog")).toHaveLength(0);
      const note = r.root.findAll((n) => n.type === "p" && text(n).includes("Couldn't check this route for toll plazas"))[0];
      expect(note).toBeTruthy(); expect(note.findAll((n) => n.type === "button" && String(n.props["aria-label"]).startsWith("Dismiss"))).toHaveLength(1);
      expect(text(r.root)).not.toMatch(/toll-free|no tolls/i);
    });
    it("route info opens inside the top stack and closes again (it never takes over the screen)", async () => {
      h.tolls = freshTolls({ navigating: true, status: "ready", ahead: [toll(9_000)], next: toll(9_000) }); await mount();
      await act(async () => { btn("Toll · 9").props.onClick(); });
      const dialog = r.root.findAll((n) => n.props.role === "dialog")[0]; expect(dialog).toBeTruthy();
      expect(stacks()[0].findAll((n) => n === dialog)).toHaveLength(1);
      await act(async () => { btn("Close route info").props.onClick(); }); expect(r.root.findAll((n) => n.props.role === "dialog")).toHaveLength(0);
    });
  });

  describe("messages", () => {
    it("a failure to share your location is a quiet, dismissible note in plain words: no developer talk, no alarm", async () => {
      (h.live.drive as { shareFailed: boolean }).shareFailed = true; await mount();
      const t = text(r.root); expect(t).toContain("Your live location isn't reaching the group right now. Your drive and directions are not affected.");
      expect(t).not.toMatch(/database|applied|update was/i);
      const p = r.root.findAll((n) => n.type === "p" && text(n).includes("isn't reaching the group"))[0];
      expect(p.props.role).toBe("status"); // polite, not an alarm
    });
    it("dismissing it keeps it away while the problem lasts, and it returns if the problem goes away and comes back", async () => {
      (h.live.drive as { shareFailed: boolean }).shareFailed = true; await mount();
      await act(async () => { r.root.findAll((n) => n.type === "button" && String(n.props["aria-label"]).startsWith("Dismiss"))[0].props.onClick(); });
      expect(text(r.root)).not.toContain("isn't reaching the group");
      await rerender(); await rerender(); expect(text(r.root)).not.toContain("isn't reaching the group");
      (h.live.drive as { shareFailed: boolean }).shareFailed = false; await rerender();
      (h.live.drive as { shareFailed: boolean }).shareFailed = true; await rerender();
      expect(text(r.root)).toContain("isn't reaching the group");
    });
    it("a real GPS problem is shown as important and cannot be dismissed away; while still locating, the start card owns that message", async () => {
      (h.live.drive as { error: string }).error = "Location permission was denied."; await mount();
      expect(text(r.root)).toContain("Location permission was denied.");
      expect(r.root.findAll((n) => n.type === "p" && text(n).includes("Location permission")).flatMap((p) => p.findAll((n) => n.type === "button"))).toHaveLength(0);
      (h.live.drive as { locating: boolean }).locating = true; await rerender(); expect(text(r.root)).not.toContain("Location permission was denied.");
    });
    it("only one message at a time; the others are counted and kept in route info (nothing is lost)", async () => {
      (h.live.drive as { shareFailed: boolean; error: string }).shareFailed = true; (h.live.drive as { error: string }).error = "Location permission was denied."; await mount();
      expect(text(r.root)).toContain("Location permission was denied."); expect(text(r.root)).not.toContain("isn't reaching the group"); // the important one wins the single slot
      expect(text(btn("1 more message"))).toBe("1 more message");
      await act(async () => { btn("1 more message").props.onClick(); });
      expect(text(r.root.findAll((n) => n.props.role === "dialog")[0])).toContain("isn't reaching the group");
    });
    it("alert cards: one at a time on the map, the rest counted, critical ones never hidden; dismissal is wired", async () => {
      const a = (id: string, level: number) => ({ id, kind: "toll", level, title: `T ${id}`, body: "b", at: 1 });
      h.alerts.active = [a("one", 2), a("two", 2), a("three", 3)]; await mount();
      expect(r.root.findAll((n) => n.type === "section" && n.props["aria-live"])).toHaveLength(1);
      expect(text(btn("2 more messages"))).toBe("2 more messages");
      h.alerts.active = [a("one", 2), a("c1", 1), a("c2", 1)]; await rerender();
      expect(r.root.findAll((n) => n.type === "section" && n.props["aria-live"]).map((s) => s.props.role)).toEqual(["alert", "alert"]);
      await act(async () => { r.root.findAll((n) => n.type === "button" && String(n.props["aria-label"]).startsWith("Dismiss: T c1"))[0].props.onClick(); });
      expect(dismissed).toEqual(["c1"]);
    });
    it("alert cards are part of the stack (inline), not a second fixed layer over the map", async () => {
      h.alerts.active = [{ id: "x", kind: "toll", level: 2, title: "Toll plaza ahead", body: "b", at: 1 }]; await mount();
      expect(all()).not.toContain("fixed inset-x-3"); expect(stacks()[0].findAll((n) => n.props["data-testid"] === "alert-banners")).toHaveLength(1);
    });
  });

  describe("closed and resumed trips", () => {
    const planned = { state: "after", lastDate: "2026-10-02", daysUntil: null, todayDay: null, firstDate: "2026-10-01", headline: "" };
    it("a trip whose planned dates passed is shown as ended (saved journey), with a clearly named button to drive it again", async () => {
      h.live.timing = planned; await mount();
      expect(text(r.root)).toContain("Trip ended"); expect(btn("Drive this route again")).toBeTruthy();
    });
    it("a RESUMED trip is not ended, even though its planned dates passed: you can simply start your drive", async () => {
      h.live.timing = planned; h.live.resumed = true; await mount();
      expect(text(r.root)).not.toContain("Trip ended"); expect(btn("Start drive")).toBeTruthy();
    });
    it("a finished or cancelled trip is shown as history, whatever its dates say, and never starts navigation by itself", async () => {
      h.live.closed = true; h.live.timing = { ...planned, state: "during", todayDay: 1 }; await mount();
      expect(text(r.root)).toContain("Trip ended"); expect(btn("Drive this route again")).toBeTruthy();
      expect((h.live.drive as { start: ReturnType<typeof vi.fn> }).start).not.toHaveBeenCalled();
      expect((h.live.navigation as { phase: string }).phase).toBe("idle");
    });
    it("a drive in progress is never replaced by the ended view", async () => {
      h.live.closed = true; (h.live.drive as { active: boolean }).active = true; await mount();
      expect(text(r.root)).not.toContain("Trip ended"); expect(btn("Stop drive")).toBeTruthy();
    });
  });

  describe("the radar sheet", () => {
    it("starts open when you are just looking, and folded when you are driving (so it does not cover half the map)", async () => {
      await mount(); const t = () => r.root.findAll((n) => n.type === "button" && text(n).includes("Travel Radar"))[0];
      expect(t().props["aria-expanded"]).toBe(true);
      await act(async () => { r.unmount(); }); (h.live.drive as { active: boolean }).active = true; await mount();
      expect(t().props["aria-expanded"]).toBe(false);
      await act(async () => { t().props.onClick(); }); expect(t().props["aria-expanded"]).toBe(true); // the traveller can still open it
    });
  });
});
