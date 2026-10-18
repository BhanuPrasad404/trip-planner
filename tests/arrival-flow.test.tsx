import { createElement, act, type MutableRefObject } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArrivalCard } from "@/components/ArrivalCard";
import { useArrival } from "@/lib/client/use-arrival";
import type { Me } from "@/lib/client/use-drive";
import type { ArrivalStop } from "@/lib/trip/arrival";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const T0 = 1_800_000_000_000;
const M = 111_195;
const stop = (o: Partial<ArrivalStop> = {}): ArrivalStop => ({ id: "s1", name: "Bhongir Fort", lat: 17.5126, lng: 78.8886, category: "temple", status: "planned", order: 1, ...o });

describe("useArrival: asks, never decides", () => {
  let store: Record<string, string>; let now: number;
  beforeEach(() => {
    store = {}; now = T0; vi.useFakeTimers(); vi.setSystemTime(T0);
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  let api: ReturnType<typeof useArrival>; let ref: MutableRefObject<((m: Me) => void) | null>; let r: TestRenderer.ReactTestRenderer;
  let marks: [string, string, string | undefined][]; let prompted: string[]; let markResult: "saved" | "queued";
  type Cfg = { stops?: ArrivalStop[]; enabled?: boolean; session?: number };
  const Probe = (c: Cfg) => {
    ref = { current: null } as MutableRefObject<((m: Me) => void) | null>;
    // keep ONE ref across renders
    return createElement(Inner, { ...c });
  };
  const holder: { ref: MutableRefObject<((m: Me) => void) | null> } = { ref: { current: null } };
  const Inner = (c: Cfg) => {
    api = useArrival({ tripId: "t1", userId: "u1", stops: c.stops ?? [stop()], enabled: c.enabled ?? true, session: c.session ?? 1, arrivalRef: holder.ref, mark: async (id, st, name) => { marks.push([id, st, name]); return markResult; }, onPrompt: (s) => { prompted.push(s.name); } });
    return null;
  };
  const mount = async (c: Cfg = {}) => { marks = []; prompted = []; markResult = "saved"; holder.ref.current = null; await act(async () => { r = TestRenderer.create(createElement(Inner, c)); }); };
  const rerender = async (c: Cfg) => { await act(async () => { r.update(createElement(Inner, c)); }); };
  afterEach(() => { act(() => r?.unmount()); void Probe; void ref; });

  const me = (northM: number, o: Partial<Me> = {}): Me => ({ lat: 17.5126 + northM / M, lng: 78.8886, heading: null, speedKmh: 2, accuracyM: 20, at: now, fixAt: now, ...o });
  const feed = async (...reads: { n: number; after: number; o?: Partial<Me> }[]) => { for (const x of reads) { now += x.after * 1000; vi.setSystemTime(now); await act(async () => { holder.ref.current?.(me(x.n, { at: now, fixAt: now, ...(x.o ?? {}) })); }); } };
  const arrive = () => feed({ n: 30, after: 0 }, { n: 30, after: 25 });

  it("does nothing until a drive is live and confirmed", async () => { await mount({ enabled: false }); await arrive(); expect(api.prompt).toBeNull(); expect(prompted).toEqual([]); });
  it("asks after a real stay, once, and tells the outside world once", async () => {
    await mount(); await feed({ n: 30, after: 0 }); expect(api.prompt).toBeNull();
    await feed({ n: 30, after: 25 }, { n: 30, after: 10 }, { n: 25, after: 10 });
    expect(api.prompt).toMatchObject({ name: "Bhongir Fort", accuracyM: 20 }); expect(prompted).toEqual(["Bhongir Fort"]);
    expect(marks).toEqual([]); // asking is not marking
  });
  it("a start point the traveller picked never prompts", async () => { await mount(); await feed({ n: 0, after: 0, o: { manual: true } }, { n: 0, after: 30, o: { manual: true } }); expect(api.prompt).toBeNull(); });
  it("YES marks the stop done (and only then), with its name for the error message", async () => {
    await mount(); await arrive();
    await act(async () => { api.confirm(); await Promise.resolve(); });
    expect(marks).toEqual([["s1", "done", "Bhongir Fort"]]); expect(api.prompt).toBeNull(); expect(api.done).toMatchObject({ name: "Bhongir Fort", queued: false, earlier: [] });
  });
  it("with no signal the answer is kept: the card says it will be sent later", async () => {
    await mount(); markResult = "queued"; await arrive();
    await act(async () => { api.confirm(); await Promise.resolve(); });
    expect(api.done?.queued).toBe(true);
  });
  it("NOT YET dismisses without marking anything, and it is not asked again while they are still there", async () => {
    await mount(); await arrive(); act(() => api.dismiss());
    expect(api.prompt).toBeNull(); expect(marks).toEqual([]);
    await feed({ n: 30, after: 30 }, { n: 30, after: 30 }, { n: 30, after: 30 }); expect(api.prompt).toBeNull();
  });
  it("a dismissal is remembered across a page reload (the phone, this trip)", async () => {
    await mount(); await arrive(); act(() => api.dismiss());
    expect(JSON.parse(store["tm:arrival:u1:t1"]).s1.outcome).toBe("dismissed");
    act(() => r.unmount()); await mount(); await feed({ n: 30, after: 30 }, { n: 30, after: 30 }); expect(api.prompt).toBeNull();
  });
  it("arriving at a later stop OFFERS the earlier ones as skipped; they are marked only if the traveller says so", async () => {
    const day = [stop({ id: "a", name: "Early Temple", order: 1, lat: 17.0 }), stop({ id: "b", name: "Bhongir Fort", order: 2 })];
    await mount({ stops: day }); await arrive();
    await act(async () => { api.confirm(); await Promise.resolve(); });
    expect(api.done?.earlier).toEqual([{ id: "a", name: "Early Temple" }]);
    expect(marks).toEqual([["b", "done", "Bhongir Fort"]]); // the earlier stop was NOT touched
    await act(async () => { await api.skipEarlier(); });
    expect(marks).toEqual([["b", "done", "Bhongir Fort"], ["a", "skipped", "Early Temple"]]); expect(api.done?.earlier).toEqual([]);
  });
  it("'keep them planned' marks nothing", async () => {
    const day = [stop({ id: "a", name: "Early Temple", order: 1, lat: 17.0 }), stop({ id: "b", name: "Bhongir Fort", order: 2 })];
    await mount({ stops: day }); await arrive(); await act(async () => { api.confirm(); await Promise.resolve(); });
    act(() => api.keepEarlier()); expect(marks).toEqual([["b", "done", "Bhongir Fort"]]); expect(api.done?.earlier).toEqual([]);
  });
  it("UNDO puts the stop back to planned, and does not nag again straight away", async () => {
    await mount(); await arrive(); await act(async () => { api.confirm(); await Promise.resolve(); });
    await act(async () => { await api.undo(); });
    expect(marks.at(-1)).toEqual(["s1", "planned", "Bhongir Fort"]); expect(api.done).toBeNull();
    await feed({ n: 30, after: 30 }, { n: 30, after: 30 }); expect(api.prompt).toBeNull();
  });
  it("a vague reading near the stop says 'you may be near', never asks to confirm, and can be marked by hand", async () => {
    await mount(); await feed({ n: 200, after: 0, o: { accuracyM: 150 } });
    expect(api.prompt).toBeNull(); expect(api.unsure).toMatchObject({ name: "Bhongir Fort", accuracyM: 150 }); expect(marks).toEqual([]);
    await act(async () => { api.confirmUnsure(); await Promise.resolve(); });
    expect(marks).toEqual([["s1", "done", "Bhongir Fort"]]);
  });
  it("dismissing 'you may be near' does not come back", async () => {
    await mount(); await feed({ n: 200, after: 0, o: { accuracyM: 150 } }); act(() => api.dismissUnsure());
    expect(api.unsure).toBeNull(); await feed({ n: 200, after: 10, o: { accuracyM: 150 } }); expect(api.unsure).toBeNull();
  });
  it("a new drive starts clean: a prompt from the earlier drive is not shown", async () => {
    await mount({ session: 1 }); await arrive(); expect(api.prompt).not.toBeNull();
    await rerender({ session: 2 }); expect(api.prompt).toBeNull();
  });
  it("ending the drive hides the prompt", async () => { await mount(); await arrive(); expect(api.prompt).not.toBeNull(); await rerender({ enabled: false }); expect(api.prompt).toBeNull(); });
});

describe("ArrivalCard: what the traveller reads", () => {
  const noop = () => {};
  const base = { prompt: null, unsure: null, done: null, progress: null, next: null, busy: false, onConfirm: noop, onDismiss: noop, onConfirmUnsure: noop, onDismissUnsure: noop, onUndo: noop, onSkipEarlier: noop, onKeepEarlier: noop, onClose: noop, onNavigate: null };
  const html = (o: Partial<Parameters<typeof ArrivalCard>[0]>) => renderToStaticMarkup(createElement(ArrivalCard, { ...base, ...o }));

  it("shows nothing when there is nothing to say", () => { expect(html({})).toBe(""); });
  it("asks the exact question, with the evidence and a way to say no", () => {
    const h = html({ prompt: { name: "Bhongir Fort", distanceM: 42, accuracyM: 18 } });
    expect(h).toContain("You have arrived at Bhongir Fort"); expect(h).toContain("Mark it as done when you");
    expect(h).toContain("About 42 m from its pin"); expect(h).toContain("±18 m");
    expect(h).toContain("Mark as done"); expect(h).toContain("Not yet"); expect(h).toContain('aria-label="Dismiss: not at Bhongir Fort yet"');
    expect(h).toContain('role="alertdialog"'); expect(h).toContain("pointer-events-none"); // never blocks the map behind it
  });
  it("the touch targets are large (44 px+)", () => { expect(html({ prompt: { name: "X", distanceM: 1, accuracyM: 1 } })).toContain("h-11 w-11"); });
  it("a weak GPS says so, and never offers to confirm for you", () => {
    const h = html({ unsure: { name: "Bhongir Fort", distanceM: 120, accuracyM: 140 } });
    expect(h).toContain("You may be near Bhongir Fort."); expect(h).toContain("isn&#x27;t precise enough to be sure"); expect(h).toContain("±140 m"); expect(h).toContain("we won&#x27;t mark it for you");
    expect(h).not.toContain("You have arrived");
  });
  it("after yes: confirmation, progress, next stop with distance, and the ways to go", () => {
    const h = html({ done: { name: "Bhongir Fort", queued: false, earlier: [] }, progress: { done: 2, total: 4 }, next: { name: "Kolanupaka", km: 22.4, minutes: 31, mapsHref: "https://www.google.com/maps/dir/?api=1&destination=1,2" }, onNavigate: noop });
    expect(h).toContain("Bhongir Fort marked as done."); expect(h).toContain("2 of 4 stops done today."); expect(h).toContain("Next: Kolanupaka"); expect(h).toContain("22 km"); expect(h).toContain("about 31 min");
    expect(h).toContain("Navigate from here"); expect(h).toContain("Open in Google Maps"); expect(h).toContain("Undo");
  });
  it("saved offline: it says it is kept on the phone", () => { expect(html({ done: { name: "Fort", queued: true, earlier: [] } })).toContain("Saved on this phone. It will be sent when you&#x27;re back online."); });
  it("no navigate button when a route can't be started (drive not active)", () => { expect(html({ done: { name: "Fort", queued: false, earlier: [] }, next: { name: "K", km: null, minutes: null, mapsHref: null } })).not.toContain("Navigate from here"); });
  it("skipped stops are offered with a choice, and the next-stop block waits until they decide", () => {
    const h = html({ done: { name: "Fort", queued: false, earlier: [{ id: "a", name: "Early Temple" }, { id: "b", name: "Lake" }] }, next: { name: "K", km: 3, minutes: 5, mapsHref: null } });
    expect(h).toContain("You skipped 2 earlier stops: Early Temple, Lake."); expect(h).toContain("Mark skipped"); expect(h).toContain("Keep them planned"); expect(h).toContain("Nothing changes unless you choose");
    expect(h).not.toContain("Next: K");
  });
  it("a single skipped stop is worded in the singular", () => { expect(html({ done: { name: "F", queued: false, earlier: [{ id: "a", name: "A" }] } })).toContain("You skipped 1 earlier stop: A."); });
  it("short distances show a decimal, long ones are rounded", () => {
    expect(html({ done: { name: "F", queued: false, earlier: [] }, next: { name: "K", km: 4.26, minutes: null, mapsHref: null } })).toContain("4.3 km");
    expect(html({ done: { name: "F", queued: false, earlier: [] }, next: { name: "K", km: 118.4, minutes: null, mapsHref: null } })).toContain("118 km");
  });
});
