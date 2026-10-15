import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertBanners, AlertSettings } from "@/components/AlertCenter";
import { useAlerts } from "@/lib/client/use-alerts";
import type { AppAlert } from "@/lib/alerts/delivery";
import { DEFAULT_ALERT_PREFS } from "@/lib/alerts/prefs";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ist = (h: number, m = 0) => Date.UTC(2026, 9, 14, h, m) - 330 * 60_000;
const alert = (o: Partial<AppAlert> = {}): AppAlert => ({ id: "toll:1", kind: "toll", level: 2, title: "Toll plaza ahead", body: "About 4.8 km ahead.", ...o });

describe("useAlerts: the real hook against fake browser channels", () => {
  let store: Record<string, string>; let visible: boolean; let perm: "granted" | "denied" | "default"; let requested: number;
  let shown: { title: string; opts: Record<string, unknown> }[]; let vibes: unknown[]; let tones: number; let registered: string[]; let hasNotification: boolean;
  beforeEach(() => {
    store = {}; visible = true; perm = "granted"; requested = 0; shown = []; vibes = []; tones = 0; registered = []; hasNotification = true;
    vi.useFakeTimers(); vi.setSystemTime(ist(14));
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } }, addEventListener: () => undefined, removeEventListener: () => undefined, setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (i: number) => clearTimeout(i) });
    vi.stubGlobal("document", { get visibilityState() { return visible ? "visible" : "hidden"; } });
    vi.stubGlobal("navigator", { vibrate: (p: unknown) => { vibes.push(p); return true; }, serviceWorker: { register: async (u: string) => { registered.push(u); return {}; }, getRegistration: async () => ({ showNotification: async (title: string, opts: Record<string, unknown>) => { shown.push({ title, opts }); } }) } });
    class FakeAudio { currentTime = 0; destination = {}; constructor() { tones++; } createGain() { return { gain: { value: 0 }, connect() {} }; } createOscillator() { return { frequency: { value: 0 }, type: "", connect() {}, start() {}, stop() {} }; } close() { return Promise.resolve(); } }
    vi.stubGlobal("AudioContext", FakeAudio);
    const N = function () {} as unknown as { permission: string; requestPermission: () => Promise<string> };
    Object.defineProperty(N, "permission", { get: () => perm });
    N.requestPermission = async () => { requested++; return perm; };
    if (hasNotification) vi.stubGlobal("Notification", N);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  let api: ReturnType<typeof useAlerts>; let r: TestRenderer.ReactTestRenderer;
  const Probe = () => { api = useAlerts(330); return null; };
  const mount = async (prefs?: object) => { if (prefs) store["tm:alert-prefs"] = JSON.stringify(prefs); await act(async () => { r = TestRenderer.create(createElement(Probe)); }); await act(async () => { await vi.advanceTimersByTimeAsync(5); }); };
  afterEach(() => { act(() => r?.unmount()); });
  const fire = async (a: AppAlert, opts?: { test?: boolean }) => { let ok = false; await act(async () => { ok = api.notify(a, undefined, opts); await vi.advanceTimersByTimeAsync(5); }); return ok; };

  it("never asks for notification permission by itself", async () => { await mount(); expect(requested).toBe(0); expect(registered).toEqual([]); });
  it("an alert with a lifetime removes its own card when the time is up, but only THAT showing (a newer one keeps its own)", async () => {
    await mount();
    await fire(alert({ id: "toll:9", ttlMs: 60_000 }));
    expect(api.active.map((a) => a.id)).toEqual(["toll:9"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await fire(alert({ id: "toll:9", ttlMs: 60_000, cooldownMs: 0 })); // the same plaza announced again 30 s later
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); }); // the FIRST showing's 60 s are over, the second's are not
    expect(api.active.map((a) => a.id)).toEqual(["toll:9"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.active).toEqual([]);
  });
  it("without a lifetime an important alert stays until dismissed (nothing important disappears by itself)", async () => {
    await mount();
    await fire(alert({ id: "arrival:1", kind: "arrival", level: 1 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000); });
    expect(api.active.map((a) => a.id)).toEqual(["arrival:1"]);
    act(() => api.dismiss("arrival:1")); expect(api.active).toEqual([]);
  });
  it("app open: a card and a short buzz; no phone notification, no tone unless asked", async () => {
    await mount(); expect(await fire(alert())).toBe(true);
    expect(api.active.map((a) => a.id)).toEqual(["toll:1"]); expect(vibes).toEqual([[120]]); expect(shown).toEqual([]); expect(tones).toBe(0);
  });
  it("app in the background with phone notifications on: a phone notification, tagged so it replaces itself, silent unless sound is on", async () => {
    await mount({ phone: true }); visible = false; await fire(alert());
    expect(shown).toHaveLength(1); expect(shown[0].title).toBe("Toll plaza ahead"); expect(shown[0].opts).toMatchObject({ tag: "toll:1", body: "About 4.8 km ahead.", silent: true });
  });
  it("with sound on, the background notification is not silent, and an open app gets the tone", async () => {
    await mount({ phone: true, sound: true }); visible = false; await fire(alert({ id: "a" })); expect(shown[0].opts.silent).toBe(false);
    visible = true; await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); await fire(alert({ id: "b" })); expect(tones).toBe(1);
  });
  it("the same alert is shown once, not again", async () => { await mount(); expect(await fire(alert())).toBe(true); expect(await fire(alert())).toBe(false); expect(api.history).toHaveLength(1); expect(vibes).toHaveLength(1); });
  it("quiet hours: the card appears, but no buzz and no phone notification", async () => {
    await mount({ phone: true }); vi.setSystemTime(ist(23, 30)); visible = false; await fire(alert());
    expect(api.active).toHaveLength(1); expect(vibes).toEqual([]); expect(shown).toEqual([]);
  });
  it("a critical alert gets through at night with a longer pattern, and stays until dismissed", async () => {
    await mount({ phone: true }); vi.setSystemTime(ist(2)); visible = false; await fire(alert({ level: 1, id: "crit" }));
    expect(vibes).toEqual([[180, 90, 180]]); expect(shown[0].opts).toMatchObject({ requireInteraction: true });
  });
  it("no more than 3 phone notifications in 10 minutes", async () => {
    await mount({ phone: true }); visible = false;
    for (let i = 0; i < 5; i++) { await fire(alert({ id: `n${i}` })); await act(async () => { await vi.advanceTimersByTimeAsync(25_000); }); }
    expect(shown).toHaveLength(3);
  });
  it("two buzzes within 20 seconds are one too many", async () => { await mount(); await fire(alert({ id: "x" })); await fire(alert({ id: "y" })); expect(vibes).toHaveLength(1); expect(api.active).toHaveLength(2); });
  it("switched off: nothing at all", async () => { await mount({ enabled: false }); await fire(alert()); expect(api.active).toEqual([]); expect(vibes).toEqual([]); expect(shown).toEqual([]); });
  it("the traveller can dismiss a card, and an action button runs its handler and closes the card", async () => {
    await mount(); const handled: string[] = [];
    await act(async () => { api.notify(alert({ id: "a", actions: [{ id: "go", label: "Navigate" }] }), (x) => handled.push(x)); });
    act(() => api.act("a", "go")); expect(handled).toEqual(["go"]); expect(api.active).toEqual([]);
    await act(async () => { api.notify(alert({ id: "b" })); }); act(() => api.dismiss("b")); expect(api.active).toEqual([]);
  });
  it("enabling phone notifications asks once (from the tap), registers the worker, and remembers the choice", async () => {
    await mount(); let res; await act(async () => { res = await api.enablePhone(); });
    expect(res).toBe("granted"); expect(requested).toBe(1); expect(registered).toEqual(["/sw.js"]); expect(api.prefs.phone).toBe(true); expect(api.permission).toBe("granted");
  });
  it("if the browser says no, the choice is switched off and nothing is registered", async () => {
    perm = "denied"; await mount({ phone: true }); await act(async () => { await api.enablePhone(); });
    expect(api.prefs.phone).toBe(false); expect(api.permission).toBe("denied"); expect(registered).toEqual([]);
  });
  it("a browser without notifications is handled without errors, and in-app alerts still work", async () => {
    hasNotification = false; vi.unstubAllGlobals(); /* re-stub without Notification */
    vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => undefined }, addEventListener: () => undefined, removeEventListener: () => undefined, setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (i: number) => clearTimeout(i) });
    vi.stubGlobal("document", { visibilityState: "visible" }); vi.stubGlobal("navigator", {});
    await mount(); expect(api.permission).toBe("unsupported");
    let res; await act(async () => { res = await api.enablePhone(); }); expect(res).toBe("unsupported");
    await fire(alert()); expect(api.active).toHaveLength(1);
  });
  it("a test alert works in quiet hours and with the app open, so the traveller can check their settings", async () => {
    await mount({ phone: true, sound: true }); vi.setSystemTime(ist(23, 45));
    await act(async () => { api.sendTest(); await vi.advanceTimersByTimeAsync(5); });
    expect(api.active[0].title).toBe("Test alert"); expect(vibes).toHaveLength(1); expect(tones).toBe(1); expect(shown).toHaveLength(1);
  });
  it("damaged saved settings fall back to the defaults", async () => { store["tm:alert-prefs"] = "{{{"; await mount(); expect(api.prefs).toEqual(DEFAULT_ALERT_PREFS); });
});

describe("the components", () => {
  const noop = () => {};
  it("banners: nothing when there are none; critical ones are announced assertively, the rest politely; every one can be dismissed", () => {
    expect(renderToStaticMarkup(createElement(AlertBanners, { alerts: [], onDismiss: noop, onAction: noop }))).toBe("");
    const h = renderToStaticMarkup(createElement(AlertBanners, { alerts: [{ ...alert({ id: "c", level: 1, title: "Road closed" }), at: 1 }, { ...alert({ actions: [{ id: "go", label: "Show on map" }] }), at: 2 }], onDismiss: noop, onAction: noop }));
    expect(h).toContain('role="alert"'); expect(h).toContain('aria-live="assertive"'); expect(h).toContain('role="status"'); expect(h).toContain("Show on map");
    expect(h).toContain('aria-label="Dismiss: Road closed"'); expect(h).toContain("pointer-events-none"); expect(h).toContain("h-11 w-11");
  });
  const settings = (o: Partial<Parameters<typeof AlertSettings>[0]> = {}) => renderToStaticMarkup(createElement(AlertSettings, { prefs: { ...DEFAULT_ALERT_PREFS, phone: true }, permission: "granted", onChange: noop, onEnablePhone: noop, onTest: noop, ...o }));
  it("settings: plain choices, a test button, and honest limits", () => {
    const h = settings();
    for (const t of ["Phone notifications", "Sound", "Vibration", "Quiet hours", "Send a test alert", "Alerts work while Trailmate is open", "locked or the app is closed", "Home Screen"]) expect(h).toContain(t);
    expect(h).toContain('role="switch"'); expect(h).toContain("22:00"); expect(h).toContain("07:00");
  });
  it("each permission state is explained in words", () => {
    expect(settings({ permission: "denied" })).toContain("blocked in this browser");
    expect(settings({ permission: "default" })).toContain("haven&#x27;t been allowed yet");
    expect(settings({ permission: "unsupported" })).toContain("can&#x27;t show phone notifications");
    expect(settings({ permission: "granted" })).toContain("Phone notifications are allowed.");
  });
  it("quiet hours inputs appear only when quiet hours are on", () => { expect(settings({ prefs: { ...DEFAULT_ALERT_PREFS, quiet: null } })).not.toContain('type="time"'); expect(settings()).toContain('type="time"'); });
  it("when alerts are off the other choices and the test are disabled", () => {
    const h = settings({ prefs: { ...DEFAULT_ALERT_PREFS, enabled: false } });
    expect((h.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
