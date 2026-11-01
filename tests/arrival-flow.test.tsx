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
  let marks: [string, string, string | undefined, string | undefined][]; let arrivals: [string, boolean, string | undefined][]; let prompted: string[]; let markResult: "saved" | "queued"; let arriveResult: "saved" | "queued"; let evidences: unknown[]; let notes: [string, string, string][];
  type Cfg = { stops?: ArrivalStop[]; enabled?: boolean; session?: number };
  const Probe = (c: Cfg) => {
    ref = { current: null } as MutableRefObject<((m: Me) => void) | null>;
    // keep ONE ref across renders
    return createElement(Inner, { ...c });
  };
  const holder: { ref: MutableRefObject<((m: Me) => void) | null> } = { ref: { current: null } };
  const Inner = (c: Cfg) => {
    api = useArrival({ tripId: "t1", userId: "u1", stops: c.stops ?? [stop()], enabled: c.enabled ?? true, session: c.session ?? 1, arrivalRef: holder.ref, mark: async (id, st, name, expected) => { marks.push([id, st, name, expected]); return markResult; }, arrive: async (id, arrived, name, evidence) => { arrivals.push([id, arrived, name]); evidences.push(evidence); return arriveResult; }, note: (kind, s) => { notes.push([kind, s.id, s.name]); }, onPrompt: (s) => { prompted.push(s.name); } });
    return null;
  };
  const mount = async (c: Cfg = {}) => { marks = []; arrivals = []; evidences = []; notes = []; prompted = []; markResult = "saved"; arriveResult = "saved"; holder.ref.current = null; await act(async () => { r = TestRenderer.create(createElement(Inner, c)); }); };
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
    expect(marks).toEqual([]); expect(arrivals).toEqual([]); // asking is not recording
  });
  it("a start point the traveller picked never prompts", async () => { await mount(); await feed({ n: 0, after: 0, o: { manual: true } }, { n: 0, after: 30, o: { manual: true } }); expect(api.prompt).toBeNull(); });
  it("YES records the ARRIVAL (and only then), never the visit: the stop stays planned until the traveller marks it", async () => {
    await mount(); await arrive();
    await act(async () => { api.confirm(); await Promise.resolve(); });
    expect(arrivals).toEqual([["s1", true, "Bhongir Fort"]]); expect(marks).toEqual([]);
    expect(api.prompt).toBeNull(); expect(api.done).toMatchObject({ name: "Bhongir Fort", queued: false, earlier: [], stage: "arrived" });
  });
  it("'Mark as visited' is a separate step after arriving, expecting the stop to still be planned", async () => {
    await mount(); await arrive();
    await act(async () => { api.confirm(); await Promise.resolve(); });
    await act(async () => { await api.complete(); });
    expect(marks).toEqual([["s1", "done", "Bhongir Fort", "planned"]]); expect(api.done).toMatchObject({ stage: "done" });
  });
  it("closing the card ('still exploring') leaves the stop planned and records nothing more", async () => {
    await mount(); await arrive();
    await act(async () => { api.confirm(); await Promise.resolve(); });
    act(() => api.closeDone());
    expect(api.done).toBeNull(); expect(marks).toEqual([]); expect(arrivals).toHaveLength(1);
    await feed({ n: 30, after: 30 }, { n: 30, after: 30 }); expect(api.prompt).toBeNull(); // answered once: not asked again
  });
  it("with no signal the answer is kept: the card says it will be sent later", async () => {
    await mount(); arriveResult = "queued"; await arrive();
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
    expect(arrivals).toEqual([["b", true, "Bhongir Fort"]]); expect(marks).toEqual([]); // the earlier stop was NOT touched
    await act(async () => { await api.skipEarlier(); });
    expect(marks).toEqual([["a", "skipped", "Early Temple", "planned"]]); expect(api.done?.earlier).toEqual([]);
  });
  it("'keep them planned' marks nothing", async () => {
    const day = [stop({ id: "a", name: "Early Temple", order: 1, lat: 17.0 }), stop({ id: "b", name: "Bhongir Fort", order: 2 })];
    await mount({ stops: day }); await arrive(); await act(async () => { api.confirm(); await Promise.resolve(); });
    act(() => api.keepEarlier()); expect(marks).toEqual([]); expect(api.done?.earlier).toEqual([]);
  });
  it("'Not here yet' after arriving clears the arrival (nothing was marked visited) and does not nag again straight away", async () => {
    await mount(); await arrive(); await act(async () => { api.confirm(); await Promise.resolve(); });
    await act(async () => { await api.undo(); });
    expect(arrivals.at(-1)).toEqual(["s1", false, "Bhongir Fort"]); expect(marks).toEqual([]); expect(api.done).toBeNull();
    await feed({ n: 30, after: 30 }, { n: 30, after: 30 }); expect(api.prompt).toBeNull();
  });
  it("UNDO after 'visited' puts the stop back to planned (expecting it to be done now), and the arrival stays", async () => {
    await mount(); await arrive(); await act(async () => { api.confirm(); await Promise.resolve(); });
    await act(async () => { await api.complete(); });
    await act(async () => { await api.undo(); });
    expect(marks.at(-1)).toEqual(["s1", "planned", "Bhongir Fort", "done"]); expect(arrivals).toEqual([["s1", true, "Bhongir Fort"]]); expect(api.done).toBeNull();
    await feed({ n: 30, after: 30 }, { n: 30, after: 30 }); expect(api.prompt).toBeNull();
  });
  it("an arrival the phone noticed (and the traveller agreed to) carries the location evidence: how accurate, never where", async () => {
    await mount(); await arrive();
    await act(async () => { api.confirm(); await Promise.resolve(); });
    expect(evidences).toEqual([{ source: "gps", accuracyM: 20 }]);
  });
  it("'Just passing': nothing is recorded as arrived or visited, it is noted, and the place is not asked about again, even after leaving and returning", async () => {
    await mount(); await arrive();
    act(() => api.passing());
    expect(api.prompt).toBeNull(); expect(arrivals).toEqual([]); expect(marks).toEqual([]);
    expect(notes).toEqual([["passed_through", "s1", "Bhongir Fort"]]);
    expect(JSON.parse(store["tm:arrival:u1:t1"]).s1.outcome).toBe("passing");
    await feed({ n: 5000, after: 60 }, { n: 30, after: 60 }, { n: 30, after: 30 }, { n: 30, after: 30 });
    expect(api.prompt).toBeNull();
  });
  it("'I'm exploring' after arriving: noted in the journey, the stop stays arrived-but-not-visited, the card goes away", async () => {
    await mount(); await arrive();
    await act(async () => { api.confirm(); await Promise.resolve(); });
    act(() => api.explore());
    expect(notes).toEqual([["exploring_started", "s1", "Bhongir Fort"]]);
    expect(api.done).toBeNull(); expect(marks).toEqual([]);
  });
  it("a question is HELD while moving at driving speed and comes back when the traveller has slowed down (never lost)", async () => {
    await mount(); await arrive();
    expect(api.prompt).not.toBeNull(); expect(api.moving).toBe(false);
    await feed({ n: 30, after: 2, o: { speedKmh: 40 } });
    expect(api.moving).toBe(true); expect(api.prompt).toBeNull(); // held: not shown to someone driving
    await feed({ n: 30, after: 2, o: { speedKmh: 12 } });          // between 8 and 15: as it was
    expect(api.prompt).toBeNull();
    await feed({ n: 30, after: 2, o: { speedKmh: 3 } });
    expect(api.moving).toBe(false); expect(api.prompt).not.toBeNull(); // slowed down: the same question is asked
    expect(arrivals).toEqual([]);
  });
  it("'you may be near' is held while moving too", async () => {
    await mount(); await feed({ n: 200, after: 0, o: { accuracyM: 150, speedKmh: 2 } });
    expect(api.unsure).not.toBeNull();
    await feed({ n: 200, after: 2, o: { accuracyM: 150, speedKmh: 50 } });
    expect(api.unsure).toBeNull();
  });
  it("an unknown speed never holds a question", async () => {
    await mount(); await arrive();
    await feed({ n: 30, after: 2, o: { speedKmh: null } });
    expect(api.moving).toBe(false); expect(api.prompt).not.toBeNull();
  });
  it("a vague reading near the stop says 'you may be near', never asks to confirm, and can be marked by hand", async () => {
    await mount(); await feed({ n: 200, after: 0, o: { accuracyM: 150 } });
    expect(api.prompt).toBeNull(); expect(api.unsure).toMatchObject({ name: "Bhongir Fort", accuracyM: 150 }); expect(marks).toEqual([]);
    await act(async () => { api.confirmUnsure(); await Promise.resolve(); });
    expect(arrivals).toEqual([["s1", true, "Bhongir Fort"]]); expect(marks).toEqual([]); // by hand it records the arrival too, never the visit
    expect(evidences).toEqual([{ source: "manual" }]); // the reading was too vague to count as evidence: it is the traveller's word alone
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
  const base = { prompt: null, unsure: null, done: null, progress: null, next: null, busy: false, onConfirm: noop, onComplete: noop, onPassing: noop, onExplore: noop, onDismiss: noop, onConfirmUnsure: noop, onDismissUnsure: noop, onUndo: noop, onSkipEarlier: noop, onKeepEarlier: noop, onClose: noop, onNavigate: null };
  const html = (o: Partial<Parameters<typeof ArrivalCard>[0]>) => renderToStaticMarkup(createElement(ArrivalCard, { ...base, ...o }));

  it("shows nothing when there is nothing to say", () => { expect(html({})).toBe(""); });
  it("the question has four honest answers on a phone: I've arrived (large), Just passing, Not yet; the destination only finishes or waits", () => {
    const h = html({ prompt: { name: "Vijayawada", distanceM: 900, accuracyM: 60, area: true } });
    expect(h).toContain("You&#x27;ve reached the Vijayawada area"); expect(h).toContain("I&#x27;ve arrived"); expect(h).toContain("Just passing"); expect(h).toContain("Not yet"); expect(h).toContain("min-h-12");
    const d = html({ prompt: { name: "Vijayawada", distanceM: 900, accuracyM: 60, destination: true } });
    expect(d).toContain("Finish drive"); expect(d).not.toContain("Just passing");
  });
  it("asks the exact question, with the evidence and a way to say no", () => {
    const h = html({ prompt: { name: "Bhongir Fort", distanceM: 42, accuracyM: 18 } });
    expect(h).toContain("You have arrived at Bhongir Fort"); expect(h).toContain("Marking it visited is a separate step");
    expect(h).toContain("About 42 m from its pin"); expect(h).toContain("±18 m");
    expect(h).toContain("I&#x27;ve arrived"); expect(h).not.toContain("Mark as done"); expect(h).toContain("Not yet"); expect(h).toContain('aria-label="Dismiss: not at Bhongir Fort yet"');
    expect(h).toContain('role="alertdialog"'); expect(h).toContain("pointer-events-none"); // never blocks the map behind it
  });
  it("the touch targets are large (44 px+)", () => { expect(html({ prompt: { name: "X", distanceM: 1, accuracyM: 1 } })).toContain("h-11 w-11"); });
  it("a weak GPS says so, and never offers to confirm for you", () => {
    const h = html({ unsure: { name: "Bhongir Fort", distanceM: 120, accuracyM: 140 } });
    expect(h).toContain("You may be near Bhongir Fort."); expect(h).toContain("isn&#x27;t precise enough to be sure"); expect(h).toContain("±140 m"); expect(h).toContain("we won&#x27;t record it for you");
    expect(h).not.toContain("You have arrived");
  });
  it("after yes: confirmation, progress, next stop with distance, and the ways to go", () => {
    const h = html({ done: { name: "Bhongir Fort", queued: false, earlier: [], stage: "done", arrivedAt: T0 }, progress: { done: 2, total: 4 }, next: { name: "Kolanupaka", km: 22.4, minutes: 31, mapsHref: "https://www.google.com/maps/dir/?api=1&destination=1,2" }, onNavigate: noop });
    expect(h).toContain("Bhongir Fort marked as done."); expect(h).toContain("2 of 4 stops done today."); expect(h).toContain("Next: Kolanupaka"); expect(h).toContain("22 km"); expect(h).toContain("about 31 min");
    expect(h).toContain("Navigate from here"); expect(h).toContain("Open in Google Maps"); expect(h).toContain("Undo");
  });
  it("after 'I've arrived': when, that it is NOT marked visited, and three clear choices", () => {
    const h = html({ done: { name: "Kanaka Durga Temple", queued: false, earlier: [], stage: "arrived", arrivedAt: Date.UTC(2026, 10, 2, 20, 37) }, next: { name: "K", km: 3, minutes: 5, mapsHref: null } });
    expect(h).toContain("You&#x27;re at Kanaka Durga Temple."); expect(h).toContain("Arrived 2:07 AM. Not marked as visited yet."); // India time: 20:37 UTC = 02:07 next day
    expect(h).toContain("Mark as visited"); expect(h).toContain("I&#x27;m exploring"); expect(h).toContain("Not here yet");
    expect(h).not.toContain("marked as done."); expect(h).not.toContain("Next: K"); // the next stop waits until it is marked
  });
  it("saved offline: it says it is kept on the phone", () => { expect(html({ done: { name: "Fort", queued: true, earlier: [], stage: "done", arrivedAt: T0 } })).toContain("Saved on this phone. It will be sent when you&#x27;re back online."); });
  it("no navigate button when a route can't be started (drive not active)", () => { expect(html({ done: { name: "Fort", queued: false, earlier: [], stage: "done", arrivedAt: T0 }, next: { name: "K", km: null, minutes: null, mapsHref: null } })).not.toContain("Navigate from here"); });
  it("skipped stops are offered with a choice, and the next-stop block waits until they decide", () => {
    const h = html({ done: { name: "Fort", queued: false, earlier: [{ id: "a", name: "Early Temple" }, { id: "b", name: "Lake" }], stage: "arrived", arrivedAt: T0 }, next: { name: "K", km: 3, minutes: 5, mapsHref: null } });
    expect(h).toContain("You skipped 2 earlier stops: Early Temple, Lake."); expect(h).toContain("Mark skipped"); expect(h).toContain("Keep them planned"); expect(h).toContain("Nothing changes unless you choose");
    expect(h).not.toContain("Next: K");
  });
  it("a single skipped stop is worded in the singular", () => { expect(html({ done: { name: "F", queued: false, earlier: [{ id: "a", name: "A" }], stage: "arrived", arrivedAt: T0 } })).toContain("You skipped 1 earlier stop: A."); });
  it("short distances show a decimal, long ones are rounded", () => {
    expect(html({ done: { name: "F", queued: false, earlier: [], stage: "done", arrivedAt: T0 }, next: { name: "K", km: 4.26, minutes: null, mapsHref: null } })).toContain("4.3 km");
    expect(html({ done: { name: "F", queued: false, earlier: [], stage: "done", arrivedAt: T0 }, next: { name: "K", km: 118.4, minutes: null, mapsHref: null } })).toContain("118 km");
  });
});
