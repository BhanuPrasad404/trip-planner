import { createElement, act, useEffect } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHideOnScroll } from "@/lib/client/use-hide-on-scroll";
import { useHudNotices } from "@/lib/client/use-hud-notices";
import { useImmersive } from "@/lib/client/use-immersive";
import type { HudNotice } from "@/lib/map/notices";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const n = (id: string, severity: HudNotice["severity"], extra: Partial<HudNotice> = {}): HudNotice => ({ id, severity, text: id, dismissible: true, ...extra });

describe("useHudNotices", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  let api: ReturnType<typeof useHudNotices>; let r: TestRenderer.ReactTestRenderer;
  const Probe = ({ list, max = 1 }: { list: HudNotice[]; max?: number }) => { api = useHudNotices(list, max); return null; };
  const mount = async (list: HudNotice[], max?: number) => { await act(async () => { r = TestRenderer.create(createElement(Probe, { list, max })); }); };
  const update = async (list: HudNotice[], max?: number) => { await act(async () => { r.update(createElement(Probe, { list, max })); }); };
  afterEach(() => { act(() => r?.unmount()); });

  it("shows what fits, most important first, and exposes the rest", async () => {
    await mount([n("a", "info"), n("b", "important")]);
    expect(api.shown.map((x) => x.id)).toEqual(["b"]); expect(api.hidden.map((x) => x.id)).toEqual(["a"]);
  });
  it("a dismissed message stays away while the problem lasts, however often it is re-reported", async () => {
    await mount([n("share", "info")]);
    act(() => api.dismiss("share")); expect(api.shown).toEqual([]);
    await update([n("share", "info")]); await update([n("share", "info")]);
    expect(api.shown).toEqual([]);
  });
  it("…and is shown again when the problem has gone and later comes back", async () => {
    await mount([n("share", "info")]);
    act(() => api.dismiss("share"));
    await update([]);                            // the problem resolved
    await update([n("share", "info")]);          // and it came back
    expect(api.shown.map((x) => x.id)).toEqual(["share"]);
  });
  it("an info message with a time limit hides itself; an important one never does", async () => {
    await mount([n("tip", "info", { autoHideMs: 15_000 }), n("gps", "important", { dismissible: false })], 2);
    expect(api.shown.map((x) => x.id).sort()).toEqual(["gps", "tip"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(14_000); }); expect(api.shown).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); }); expect(api.shown.map((x) => x.id)).toEqual(["gps"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000); }); expect(api.shown.map((x) => x.id)).toEqual(["gps"]);
  });
  it("a critical message is never hidden by the limit or by a timer", async () => {
    await mount([n("c", "critical", { autoHideMs: 1000 }), n("i", "info")], 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(api.shown.map((x) => x.id)).toEqual(["c"]);
  });
});

describe("useImmersive (full-screen map)", () => {
  let listeners: Record<string, ((e: unknown) => void)[]>; let root: { style: { overflow: string }; requestFullscreen?: (o?: unknown) => Promise<void> | void }; let fsElement: unknown; let exited: number; let asked: unknown[];
  beforeEach(() => {
    listeners = {}; fsElement = null; exited = 0; asked = [];
    root = { style: { overflow: "auto" }, requestFullscreen: async (o?: unknown) => { asked.push(o); } };
    vi.stubGlobal("document", {
      documentElement: root, get fullscreenElement() { return fsElement; }, exitFullscreen: async () => { exited++; },
      addEventListener: (t: string, h: (e: unknown) => void) => { (listeners[t] ??= []).push(h); }, removeEventListener: (t: string, h: (e: unknown) => void) => { listeners[t] = (listeners[t] ?? []).filter((x) => x !== h); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  let api: ReturnType<typeof useImmersive>; let r: TestRenderer.ReactTestRenderer;
  const Probe = () => { api = useImmersive(); return null; };
  const mount = async () => { await act(async () => { r = TestRenderer.create(createElement(Probe)); }); };

  it("starts normal, enters full screen (page behind stops scrolling, browser bars hidden where allowed) and leaves again", async () => {
    await mount(); expect(api.immersive).toBe(false); expect(root.style.overflow).toBe("auto");
    await act(async () => { api.toggle(); });
    expect(api.immersive).toBe(true); expect(root.style.overflow).toBe("hidden"); expect(asked).toEqual([{ navigationUI: "hide" }]);
    await act(async () => { api.toggle(); });
    expect(api.immersive).toBe(false); expect(root.style.overflow).toBe("auto"); // restored to exactly what it was
  });
  it("Escape leaves it, and the page scrolls again", async () => {
    await mount(); await act(async () => { api.enter(); });
    await act(async () => { listeners.keydown?.forEach((h) => h({ key: "Tab" })); }); expect(api.immersive).toBe(true);
    await act(async () => { listeners.keydown?.forEach((h) => h({ key: "Escape" })); });
    expect(api.immersive).toBe(false); expect(root.style.overflow).toBe("auto");
  });
  it("leaving the page while full screen restores scrolling and exits browser full screen (nothing is left locked)", async () => {
    await mount(); await act(async () => { api.enter(); }); fsElement = {};
    await act(async () => { r.unmount(); });
    expect(root.style.overflow).toBe("auto"); expect(exited).toBe(1); expect(listeners.keydown ?? []).toEqual([]);
  });
  it("a browser that refuses full screen (or has none) still gets the in-page full-screen layout", async () => {
    root.requestFullscreen = () => { throw new Error("denied"); };
    await mount(); await act(async () => { api.enter(); }); expect(api.immersive).toBe(true);
    root.requestFullscreen = undefined; await act(async () => { api.exit(); api.enter(); }); expect(api.immersive).toBe(true);
    root.requestFullscreen = async () => { throw new Error("denied later"); };
    await act(async () => { api.exit(); }); await act(async () => { api.enter(); await Promise.resolve(); }); expect(api.immersive).toBe(true);
  });
  it("the browser leaving full screen by itself does not tear down the in-page mode (the Collapse button still works)", async () => {
    await mount(); await act(async () => { api.enter(); });
    expect(listeners.fullscreenchange ?? []).toEqual([]); // not tied to it on purpose
    expect(api.immersive).toBe(true);
  });
});

describe("useHideOnScroll (bottom navigation)", () => {
  let y: number; let handlers: Record<string, (() => void)[]>; let frames: (() => void)[]; let page: { scrollHeight: number };
  beforeEach(() => {
    y = 0; handlers = {}; frames = []; page = { scrollHeight: 6000 };
    vi.stubGlobal("window", { get scrollY() { return y; }, innerHeight: 800, addEventListener: (t: string, h: () => void) => { (handlers[t] ??= []).push(h); }, removeEventListener: (t: string, h: () => void) => { handlers[t] = (handlers[t] ?? []).filter((x) => x !== h); } });
    vi.stubGlobal("document", { documentElement: page });
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { frames.push(cb); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => { frames = []; });
  });
  afterEach(() => vi.unstubAllGlobals());
  let hidden: boolean; let r: TestRenderer.ReactTestRenderer;
  const Probe = ({ enabled, k }: { enabled: boolean; k: string }) => { const h = useHideOnScroll(enabled, k); useEffect(() => { hidden = h; }); return null; };
  const mount = async (enabled = true, k = "/feed") => { await act(async () => { r = TestRenderer.create(createElement(Probe, { enabled, k })); }); };
  const scrollTo = async (to: number) => { y = to; await act(async () => { handlers.scroll?.forEach((h) => h()); frames.splice(0).forEach((f) => f()); }); };
  afterEach(() => { act(() => r?.unmount()); });

  it("is shown at first, hides when you read down, and returns when you read back up", async () => {
    await mount(); expect(hidden).toBe(false);
    for (const to of [60, 120, 200, 300]) await scrollTo(to);
    expect(hidden).toBe(true);
    await scrollTo(285); expect(hidden).toBe(false);
  });
  it("is back at the top of the page, always", async () => {
    await mount(); for (const to of [100, 200, 400]) await scrollTo(to); expect(hidden).toBe(true);
    await scrollTo(10); expect(hidden).toBe(false);
  });
  it("is never hidden on a page that barely scrolls", async () => {
    page.scrollHeight = 850; await mount();
    for (const to of [20, 40, 50]) await scrollTo(to); expect(hidden).toBe(false);
  });
  it("is never hidden when switched off (driving screens, an open menu), and does not even listen", async () => {
    await mount(false); expect(handlers.scroll ?? []).toEqual([]);
    for (const to of [100, 300, 500]) await scrollTo(to); expect(hidden).toBe(false);
  });
  it("switching it off while hidden shows the bar at once", async () => {
    await mount(true); for (const to of [100, 200, 400]) await scrollTo(to); expect(hidden).toBe(true);
    await act(async () => { r.update(createElement(Probe, { enabled: false, k: "/feed" })); }); expect(hidden).toBe(false);
  });
  it("going to another page shows it again", async () => {
    await mount(true, "/feed"); for (const to of [100, 200, 400]) await scrollTo(to); expect(hidden).toBe(true);
    await act(async () => { r.update(createElement(Probe, { enabled: true, k: "/trips" })); }); expect(hidden).toBe(false);
  });
  it("many scroll events in one frame cost one update, and it listens to the window only (a scrolling list inside the page cannot hide the bar)", async () => {
    await mount();
    y = 300; await act(async () => { for (let i = 0; i < 20; i++) handlers.scroll?.forEach((h) => h()); });
    expect(frames).toHaveLength(1);
    expect(Object.keys(handlers).sort()).toEqual(["resize", "scroll"]);
  });
  it("stops listening when the page is left", async () => {
    await mount(); await act(async () => { r.unmount(); });
    expect(handlers.scroll ?? []).toEqual([]); expect(handlers.resize ?? []).toEqual([]);
  });
});
