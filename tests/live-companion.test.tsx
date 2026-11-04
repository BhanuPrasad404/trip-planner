// The Live tab as a travel companion: the moment it is in (not started, on the road, almost there, at a stop, paused, resting, finished),
// the main action for it, the Start and Unplanned-stop sheets, the trip activity diary, the preferences, and the real-world situations
// (late start, missed day, overnight stop, skipped stop). Pure rules are tested directly; screens are rendered.
import { createElement } from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { departureTiming, explainStaleness, livePhase, PHASE_PILL } from "@/lib/trip/live-phase";
import { allowedActions, buildTimeline, deriveJourney, type JourneyEvent } from "@/lib/trip/journey";
import { planStaleness, type PStop } from "@/lib/trip/replan-proposal";
import { STOP_TYPES, STOP_TYPE_INFO } from "@/lib/trip/unplanned";
import { proposalKey, proposalBucket, PROPOSAL_REUSE_MS } from "@/lib/trip/proposal-key";
import { LiveHeader, type NextInfo } from "@/components/live/LiveHeader";
import { StartTripSheet } from "@/components/live/StartTripSheet";
import { UnplannedStopSheet } from "@/components/live/UnplannedStopSheet";
import { TripActivity } from "@/components/live/TripActivity";
import { TravelPrefsCard } from "@/components/TravelPrefsCard";
import { TimePicker } from "@/components/ui/TimePicker";
import { DEFAULT_PREFS } from "@/lib/trip/preferences";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The sheet is a portal onto the page; here it is just its content.
vi.mock("@/components/ui/Sheet", async () => { const { createElement: h } = await import("react"); return { PICKER_BUTTON: "picker-button", PickerSheet: ({ title, children, footer }: { title: string; children: unknown; footer?: unknown }) => h("div", { role: "dialog", "aria-label": title }, children as never, footer as never) }; });
let search: { results: { name: string; address: string; lat: number; lng: number; source: "map" }[]; mapSearched: boolean } = { results: [], mapSearched: false };
vi.mock("@/lib/client/use-destination-search", () => ({ useDestinationSearch: () => ({ local: [], results: search.results, mapSearched: search.mapSearched, mapLoading: false, mapError: null, searchMap: () => undefined }) }));

const flat = (n: ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(flat).join(""));
const btn = (r: TestRenderer.ReactTestRenderer, label: string) => r.root.findAll((n) => n.type === "button" && flat(n).includes(label))[0];
const press = async (r: TestRenderer.ReactTestRenderer, label: string) => { const b = btn(r, label); if (!b) throw new Error(`no button "${label}"`); await act(async () => { b.props.onClick(); }); };
const ev = (kind: JourneyEvent["kind"], at: string, o: Partial<JourneyEvent> = {}): JourneyEvent => ({ clientEventId: `evt-${kind}-${at}`.slice(0, 40), kind, occurredAt: at, source: "manual", userId: "u1", ...o });

describe("what moment the journey is in", () => {
  const j = (events: JourneyEvent[]) => deriveJourney(events);
  const dep = ev("departed", "2026-11-02T16:30:00Z");
  it("is derived from the journey's own events: nothing else decides it", () => {
    expect(livePhase({ closed: false, journey: j([]), approaching: false })).toBe("not-started");
    expect(livePhase({ closed: false, journey: j([dep]), approaching: false })).toBe("travelling");
    expect(livePhase({ closed: false, journey: j([dep]), approaching: true })).toBe("approaching");
    expect(livePhase({ closed: false, journey: j([dep, ev("paused", "2026-11-02T17:30:00Z")]), approaching: false })).toBe("paused");
    expect(livePhase({ closed: false, journey: j([dep, ev("rest_started", "2026-11-02T20:30:00Z")]), approaching: false })).toBe("resting");
    expect(livePhase({ closed: false, journey: j([dep, ev("arrived", "2026-11-02T20:30:00Z", { placeId: "v", placeName: "Vijayawada" })]), approaching: false })).toBe("at-stop");
    expect(livePhase({ closed: true, journey: j([dep]), approaching: true })).toBe("finished");
  });
  it("having arrived is 'at a stop' until the stop is finished or the arrival corrected, then the road again", () => {
    const arrived = ev("arrived", "2026-11-02T20:30:00Z", { placeId: "v", placeName: "Vijayawada" });
    expect(livePhase({ closed: false, journey: j([dep, arrived, ev("visit_completed", "2026-11-02T21:30:00Z", { placeId: "v" })]), approaching: false })).toBe("travelling");
    expect(livePhase({ closed: false, journey: j([dep, arrived, ev("arrival_corrected", "2026-11-02T20:40:00Z", { placeId: "v" })]), approaching: false })).toBe("travelling");
  });
  it("an arrival with no departure on record is kept (GPS or the tap was missed) and shown as at a stop", () => {
    expect(livePhase({ closed: false, journey: j([ev("arrived", "2026-11-02T20:30:00Z", { placeId: "v", placeName: "Vijayawada" })]), approaching: false })).toBe("at-stop");
  });
  it("overnight: resting, then back on the road next morning, without the app deciding anything", () => {
    const rest = [dep, ev("rest_started", "2026-11-02T20:30:00Z")];
    expect(livePhase({ closed: false, journey: j(rest), approaching: false })).toBe("resting");
    expect(allowedActions(j(rest).state)).toEqual(["rest_ended"]);
    expect(livePhase({ closed: false, journey: j([...rest, ev("rest_ended", "2026-11-03T02:30:00Z")]), approaching: false })).toBe("travelling");
  });
  it("every phase has a plain name", () => { for (const p of ["not-started", "travelling", "approaching", "at-stop", "paused", "resting", "finished"] as const) expect(PHASE_PILL[p].length).toBeGreaterThan(3); });
});

describe("starting early, on time, late, or after a missed day", () => {
  const T = (plannedDate: string, plannedMin: number, nowDate: string, nowMin: number) => departureTiming({ plannedDate, plannedMin, nowDate, nowMin });
  it("planned 6:30 AM, opened at 9:30 AM: three hours late, said in words", () => {
    const t = T("2026-11-02", 390, "2026-11-02", 570);
    expect(t.kind).toBe("late"); expect(t.minutes).toBe(180); expect(t.text).toBe("It's 3 h past your planned 6:30 AM departure.");
  });
  it("planned 9 AM, opened at 6:30 PM with nothing started: 9 h 30 min late", () => {
    const t = T("2026-11-02", 540, "2026-11-02", 18 * 60 + 30);
    expect(t.kind).toBe("late"); expect(t.text).toContain("9 h 30 min past your planned 9:00 AM");
  });
  it("a missed day: the plan was to leave yesterday", () => {
    expect(T("2026-11-02", 540, "2026-11-03", 600).text).toBe("The plan was to leave yesterday at 9:00 AM.");
    expect(T("2026-11-02", 540, "2026-11-05", 600).text).toBe("The plan was to leave 3 days ago at 9:00 AM.");
  });
  it("early, a day ahead, and right on time", () => {
    expect(T("2026-11-02", 540, "2026-11-02", 480).kind).toBe("early"); expect(T("2026-11-02", 540, "2026-11-02", 480).text).toContain("in 1 h");
    expect(T("2026-11-03", 540, "2026-11-02", 600).text).toBe("Your planned departure is tomorrow at 9:00 AM.");
    expect(T("2026-11-02", 540, "2026-11-02", 545).kind).toBe("on-time");
  });
  it("nothing is invented when the plan has no departure time", () => {
    expect(departureTiming({ plannedDate: "2026-11-02", plannedMin: null, nowDate: "2026-11-02", nowMin: 600 })).toEqual({ kind: "unknown", minutes: 0, text: "" });
    expect(departureTiming({ plannedDate: null, plannedMin: 540, nowDate: "2026-11-02", nowMin: 600 }).kind).toBe("unknown");
  });
  const stops: PStop[] = [{ id: "a", name: "Vijayawada", lat: 16.5, lng: 80.6, day: 1, order: 1, arrivalTime: "09:00", status: "planned", visitMin: 60, priority: "normal" }, { id: "b", name: "Kanaka Durga", lat: 16.5, lng: 80.6, day: 2, order: 1, arrivalTime: "09:00", status: "planned", visitMin: 60, priority: "normal" }];
  it("late start (not left, 3 h after planned): the plan check says what happened, why, and what happens if nothing is done", () => {
    const s = planStaleness({ stops, journey: "awaiting-departure", nowDay: 1, nowMin: 12 * 60, numDays: 2 })!;
    expect(s.kind).toBe("late-departure");
    const w = explainStaleness(s);
    expect(w.happened).toContain("Vijayawada"); expect(w.why.length).toBeGreaterThan(20); expect(w.ifNothing).toMatch(/Nothing changes/);
  });
  it("a missed travel day is found, never marked visited for the traveller, and explained", () => {
    const s = planStaleness({ stops, journey: "awaiting-departure", nowDay: 2, nowMin: 600, numDays: 2 })!;
    expect(s).toMatchObject({ kind: "missed-day", missedDays: 1, firstDay: 1 });
    expect(explainStaleness(s).ifNothing).toContain("Nothing is marked visited or skipped for you");
    expect(stops.every((x) => x.status === "planned")).toBe(true);
  });
  it("running behind on the road is explained with the hours and the stop", () => {
    const s = planStaleness({ stops, journey: "travelling", nowDay: 1, nowMin: 9 * 60 + 150, numDays: 2 })!;
    expect(s.kind).toBe("running-behind"); expect(explainStaleness(s).happened).toContain("2 h 30 min behind");
  });
  it("on time: no staleness, so no proposal is ever started", () => { expect(planStaleness({ stops, journey: "travelling", nowDay: 1, nowMin: 9 * 60 + 10, numDays: 2 })).toBeNull(); });
});

describe("the Live header: one clear thing to do for each moment", () => {
  const next: NextInfo = { name: "Kanaka Durga Temple", plannedTime: "9:00 AM", distanceText: "42 km", minutes: 55, etaClock: "9:40 AM", delay: { text: "10 min late", tone: "late" }, after: "Vijayawada" };
  const base = { tripName: "Home - vizag", route: "Visakhapatnam → Hyderabad", next, timing: { kind: "unknown" as const, minutes: 0, text: "" }, stops: { done: 1, skipped: 0, total: 4 }, since: null as string | null, atStop: null as null | { name: string; arrivedClock: string | null; canFinish: boolean }, hasLocation: true, closedWords: null as string | null, busy: false, onStart: () => {}, onUnplanned: () => {}, onPause: () => {}, onRest: () => {}, onResume: () => {}, onFinishStop: () => {} };
  const h = (o: Partial<Parameters<typeof LiveHeader>[0]> & { phase: Parameters<typeof LiveHeader>[0]["phase"] }) => renderToStaticMarkup(createElement(LiveHeader, { ...base, ...o }));

  it("not started: 'Start my trip' is the main action, wording is plain, and location is not required", () => {
    const x = h({ phase: "not-started", hasLocation: false, timing: { kind: "late", minutes: 180, text: "It's 3 h past your planned 6:30 AM departure." } });
    expect(x).toContain("Ready when you are"); expect(x).toContain("Start my trip"); expect(x).toContain("Add an unplanned stop"); expect(x).toContain("It&#x27;s 3 h past your planned 6:30 AM departure.");
    expect(x).toContain("Location isn&#x27;t needed to start."); expect(x).not.toContain("I&#x27;ve left"); expect(x).not.toContain("Short pause"); expect(x).not.toContain("I visited somewhere else");
  });
  it("on the road: next stop, distance, arrival and lateness; pause or stop for the night; no 'Start my trip'", () => {
    const x = h({ phase: "travelling", since: "since 6:30 AM" });
    expect(x).toContain("On the road to Kanaka Durga Temple"); expect(x).toContain("42 km"); expect(x).toContain("9:40 AM"); expect(x).toContain("10 min late");
    expect(x).toContain("Short pause"); expect(x).toContain("Stop for the night"); expect(x).toContain("Add an unplanned stop"); expect(x).not.toContain("Start my trip");
    expect(x).toContain("1 of 4 stops done"); expect(x).toContain('role="progressbar"');
  });
  it("never shows a distance without a live position: with location off it says it is following by hand", () => {
    const x = h({ phase: "travelling", hasLocation: false, next: { ...next, distanceText: "42 km", minutes: 55 } });
    expect(x).not.toContain("42 km"); expect(x).toContain("following your trip by what you tell us");
  });
  it("almost there: says we will ask, and that nothing is marked from location alone", () => {
    const x = h({ phase: "approaching" });
    expect(x).toContain("Almost at Kanaka Durga Temple"); expect(x).toContain("Nothing is marked from your location alone");
  });
  it("at a stop: 'Finished this stop' explained, and offered only when the stop can be marked", () => {
    const x = h({ phase: "at-stop", atStop: { name: "Kanaka Durga Temple", arrivedClock: "2:07 AM", canFinish: true } });
    expect(x).toContain("You&#x27;re at Kanaka Durga Temple"); expect(x).toContain("Finished this stop"); expect(x).toContain("Still exploring? Just carry on");
    expect(h({ phase: "at-stop", atStop: { name: "A dhaba", arrivedClock: null, canFinish: false } })).not.toContain("<span>Finished this stop");
  });
  it("paused and resting: the way back onto the road, and the plan is said to be unchanged", () => {
    expect(h({ phase: "paused" })).toContain("Back on the road"); expect(h({ phase: "paused" })).toContain("Your plan hasn&#x27;t changed");
    const r = h({ phase: "resting" }); expect(r).toContain("Rest well"); expect(r).toContain("Back on the road"); expect(r).not.toContain("Stop for the night");
  });
  it("finished: a summary and no buttons", () => {
    const x = h({ phase: "finished", closedWords: "This trip is finished." });
    expect(x).toContain("Trip finished"); expect(x).toContain("Its stops, activity and memories are kept"); expect(x).not.toContain("Add an unplanned stop"); expect(x).not.toContain("Start my trip");
  });
  it("touch targets are large and long names wrap", () => { const x = h({ phase: "travelling" }); expect(x).toContain("min-h-11"); expect(x).toContain("break-words"); expect(h({ phase: "not-started" })).toContain("min-h-14"); });
  it("the buttons call what they say", async () => {
    const calls: string[] = [];
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(LiveHeader, { ...base, phase: "travelling", onPause: () => calls.push("pause"), onRest: () => calls.push("rest"), onUnplanned: () => calls.push("unplanned") })); });
    await press(r, "Short pause"); await press(r, "Stop for the night"); await press(r, "Add an unplanned stop");
    expect(calls).toEqual(["pause", "rest", "unplanned"]);
  });
});

describe("Start my trip", () => {
  const sheet = (o: Partial<Parameters<typeof StartTripSheet>[0]> = {}) => ({ from: "Visakhapatnam", timing: { kind: "on-time" as const, minutes: 0, text: "Right around your planned 6:30 AM departure." }, hasLocation: true, onConfirm: async () => "saved" as const, onClose: () => {}, ...o });
  it("says what it will do BEFORE doing it", () => {
    const x = renderToStaticMarkup(createElement(StartTripSheet, sheet()));
    expect(x).toContain("Setting off from"); expect(x).toContain("Visakhapatnam"); expect(x).toContain("When you tap Start"); expect(x).toContain("real departure time"); expect(x).toContain("Your plan does not change.");
    expect(x).toContain("never a trail of where you went");
  });
  it("starting late: says that is fine and that nothing changes without approval", () => {
    const x = renderToStaticMarkup(createElement(StartTripSheet, sheet({ timing: { kind: "late", minutes: 190, text: "It's 3 h 10 min past your planned 6:30 AM departure." } })));
    expect(x).toContain("Starting late is fine."); expect(x).toContain("Nothing changes unless you approve it");
  });
  it("without location it still starts, and says so", () => { expect(renderToStaticMarkup(createElement(StartTripSheet, sheet({ hasLocation: false })))).toContain("Location isn&#x27;t on, so that&#x27;s fine"); });
  it("confirming records once and closes; a failure stays open and says so", async () => {
    const seen: string[] = [];
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(StartTripSheet, sheet({ onConfirm: async () => { seen.push("confirm"); return "saved" as const; }, onClose: () => seen.push("close") }))); });
    await press(r, "Start my trip now");
    expect(seen).toEqual(["confirm", "close"]);
    await act(async () => { r.unmount(); });
    const seen2: string[] = [];
    await act(async () => { r = TestRenderer.create(createElement(StartTripSheet, sheet({ onConfirm: async () => "failed" as const, onClose: () => seen2.push("close") }))); });
    await press(r, "Start my trip now");
    expect(seen2).toEqual([]); expect(flat(r.root)).toContain("That couldn't be saved");
    await act(async () => { r.unmount(); });
  });
  it("'Not yet' closes without recording", async () => {
    const seen: string[] = [];
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(StartTripSheet, sheet({ onConfirm: async () => { seen.push("confirm"); return "saved" as const; }, onClose: () => seen.push("close") }))); });
    await press(r, "Not yet");
    expect(seen).toEqual(["close"]);
    await act(async () => { r.unmount(); });
  });
});

describe("Add an unplanned stop", () => {
  const input = (r: TestRenderer.ReactTestRenderer) => r.root.findByType("input");
  const typeIn = async (r: TestRenderer.ReactTestRenderer, v: string) => { await act(async () => { input(r).props.onChange({ target: { value: v } }); }); };
  const mount = async (o: Partial<Parameters<typeof UnplannedStopSheet>[0]> = {}) => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(UnplannedStopSheet, { near: null, record: async () => "saved" as const, addToPlan: null, dayLabel: "Day 2", onClose: () => {}, ...o })); });
    return r;
  };
  it("offers every kind of stop a traveller really makes, each with a hint", async () => {
    const r = await mount();
    for (const t of STOP_TYPES) expect(flat(r.root)).toContain(STOP_TYPE_INFO[t].label);
    expect(STOP_TYPES).toEqual(["food", "fuel", "sight", "stay", "emergency", "visit", "other"]);
    await act(async () => { r.unmount(); });
  });
  it("needs a place and a kind before it will save", async () => {
    const calls: unknown[] = [];
    const r = await mount({ record: async (p) => { calls.push(p); return "saved" as const; } });
    const save = () => r.root.findAll((n) => n.type === "button" && /Choose a place|Add /.test(flat(n)) && n.props.disabled !== undefined)[0];
    expect(save().props.disabled).toBe(true);
    await typeIn(r, "Kanaka Durga Temple");
    expect(save().props.disabled).toBe(true);        // still no kind
    await press(r, "Sightseeing");
    expect(save().props.disabled).toBe(false);
    await act(async () => { await save().props.onClick(); });
    expect(calls).toEqual([{ name: "Kanaka Durga Temple", type: "sight" }]);
    expect(flat(r.root)).toContain("Added to your trip activity"); expect(flat(r.root)).toContain("Your plan is unchanged."); expect(flat(r.root)).toContain("Correct this");
    await act(async () => { r.unmount(); });
  });
  it("a place picked from the search carries its position; adding to the plan is a separate, unticked choice", async () => {
    search = { results: [{ name: "Kanaka Durga Temple", address: "Vijayawada", lat: 16.5128, lng: 80.6055, source: "map" }], mapSearched: true };
    const planned: unknown[] = [], recorded: unknown[] = [];
    const r = await mount({ record: async (p) => { recorded.push(p); return "saved" as const; }, addToPlan: async (p) => { planned.push(p); } });
    await typeIn(r, "Kanaka");
    expect(flat(r.root)).not.toContain("Also add it to my plan");   // not until a place with a position is chosen
    await press(r, "Kanaka Durga Temple");                          // the search result
    expect(flat(r.root)).toContain("Also add it to my plan"); expect(flat(r.root)).toContain("Nothing is marked done");
    await press(r, "Food break");
    const add = () => r.root.findAll((n) => n.type === "button" && /^Add /.test(flat(n)))[0];
    await act(async () => { await add().props.onClick(); });          // not ticked: the plan is left alone
    expect(recorded).toEqual([{ name: "Kanaka Durga Temple", type: "food" }]); expect(planned).toEqual([]);
    await act(async () => { r.unmount(); });

    const planned2: unknown[] = [];
    const r2 = await mount({ record: async () => "saved" as const, addToPlan: async (p) => { planned2.push(p); } });
    await typeIn(r2, "Kanaka"); await press(r2, "Kanaka Durga Temple"); await press(r2, "Sightseeing");
    await act(async () => { r2.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }); });
    await act(async () => { await r2.root.findAll((n) => n.type === "button" && /^Add /.test(flat(n)))[0].props.onClick(); });
    expect(planned2).toEqual([{ name: "Kanaka Durga Temple", lat: 16.5128, lng: 80.6055, type: "sight" }]);
    expect(flat(r2.root)).toContain("also in your plan as the next stop on Day 2");
    await act(async () => { r2.unmount(); });
    search = { results: [], mapSearched: false };
  });
  it("a name nobody has mapped is enough, and then there is no 'add to plan' (a position is never invented)", async () => {
    const r = await mount({ addToPlan: async () => {} });
    await typeIn(r, "Ravi's dhaba near the toll"); await press(r, "Food break");
    expect(flat(r.root)).not.toContain("Also add it to my plan");
    await act(async () => { await r.root.findAll((n) => n.type === "button" && /^Add /.test(flat(n)))[0].props.onClick(); });
    expect(flat(r.root)).toContain("Added to your trip activity");
    await act(async () => { r.unmount(); });
  });
  it("saved offline: it says it will be sent later; failed: it stays open with a reason", async () => {
    const r = await mount({ record: async () => "queued" as const });
    await typeIn(r, "Fuel station"); await press(r, "Fuel");
    await act(async () => { await r.root.findAll((n) => n.type === "button" && /^Add /.test(flat(n)))[0].props.onClick(); });
    expect(flat(r.root)).toContain("sent when you're back online");
    await act(async () => { r.unmount(); });
    const f = await mount({ record: async () => "failed" as const });
    await typeIn(f, "Somewhere"); await press(f, "Emergency");
    await act(async () => { await f.root.findAll((n) => n.type === "button" && /^Add /.test(flat(n)))[0].props.onClick(); });
    expect(flat(f.root)).toContain("That couldn't be saved"); expect(flat(f.root)).not.toContain("Added to your trip activity");
    await act(async () => { f.unmount(); });
  });
});

describe("Your trip activity", () => {
  const events = [ev("departed", "2026-11-02T01:00:00Z", { source: "gps" }), ev("arrived", "2026-11-02T04:45:00Z", { placeName: "Vijayawada" }), ev("unplanned_stop_added", "2026-11-02T05:30:00Z", { placeName: "Kanaka Durga Temple", meta: { category: "sight" } })];
  const rows = buildTimeline(events, { offsetMin: 330, me: "u1" });
  const mk = (o: Partial<Parameters<typeof TripActivity>[0]> = {}) => ({ rows, waiting: 0, stored: true as boolean | null, ignored: 0, offsetMin: 330, ...o });

  it("reads like a diary in plain words, newest first, with how each line is known", () => {
    const x = renderToStaticMarkup(createElement(TripActivity, mk()));
    expect(x).toContain("Your trip activity"); expect(x).toContain("Unplanned stop: Kanaka Durga Temple"); expect(x).toContain("Sightseeing"); expect(x).toContain("Arrived at Vijayawada");
    expect(x).toContain("Noticed from your phone&#x27;s location"); expect(x).toContain("You told us");
    expect(x.indexOf("Unplanned stop")).toBeLessThan(x.indexOf("Departed"));
    for (const jargon of ["Itinerary change proposed", "Automatic", "revision"]) expect(x).not.toContain(jargon);
  });
  it("the app's own 'change proposed' bookkeeping, however many, never reaches the traveller; a person's suggestion does", () => {
    const noisy = [...events, ...Array.from({ length: 9 }, (_, i) => ev("revision_proposed", "2026-11-02T04:14:00Z", { source: "system", clientEventId: `sys-proposal-${i}-xxxx`, meta: { rev: 3 + i, strategy: "extend" } })), ev("revision_proposed", "2026-11-02T06:00:00Z", { userId: "u2", clientEventId: "suggest-by-anil", meta: { rev: 4, suggested: true } })];
    const x = renderToStaticMarkup(createElement(TripActivity, mk({ rows: buildTimeline(noisy, { offsetMin: 330, me: "u1", names: { u2: "Anil" } }) })));
    expect((x.match(/Suggested a change to the plan/g) ?? []).length).toBe(1); expect(x).toContain("Anil");
    expect(x).not.toContain("Itinerary change proposed");
    expect(buildTimeline(noisy, { offsetMin: 330, me: "u1" })).toHaveLength(buildTimeline([...events, noisy[noisy.length - 1]], { offsetMin: 330, me: "u1" }).length);
  });
  it("approved and declined changes read as the schedule, not as internals", () => {
    const x = renderToStaticMarkup(createElement(TripActivity, mk({ rows: buildTimeline([...events, ev("revision_approved", "2026-11-02T07:00:00Z", { userId: "u1" }), ev("revision_rejected", "2026-11-02T08:00:00Z", { userId: "u1", clientEventId: "evt-rejected-xxxxx" })], { offsetMin: 330, me: "u1" }) })));
    expect(x).toContain("Schedule updated"); expect(x).toContain("Suggested change declined"); expect(x).toContain("The plan stays as it was");
  });
  it("an empty trip says so kindly instead of showing an empty list", () => {
    const x = renderToStaticMarkup(createElement(TripActivity, mk({ rows: [] })));
    expect(x).toContain("Nothing yet. When you start your trip"); expect(x).not.toContain("<ol");
  });
  it("long histories are folded, and waiting / unsaved / out-of-order lines are said plainly", () => {
    const many = Array.from({ length: 9 }, (_, i) => ev("unplanned_stop_added", `2026-11-02T0${i}:00:00Z`, { placeName: `Stop ${i}`, clientEventId: `evt-many-${i}-xxxxx` }));
    const x = renderToStaticMarkup(createElement(TripActivity, mk({ rows: buildTimeline(many, { offsetMin: 330, me: "u1" }), waiting: 2, stored: false, ignored: 1 })));
    expect(x).toContain("Show all 9"); expect(x).toContain("2 updates are saved on this phone"); expect(x).toContain("can&#x27;t be saved to the trip yet"); expect(x).toContain("One update didn&#x27;t fit the order of events");
  });
  it("your own lines can be corrected (the original stays, marked); other people's cannot", async () => {
    const mixed = [ev("departed", "2026-11-02T01:00:00Z"), ev("departed", "2026-11-02T02:00:00Z", { userId: "u2", clientEventId: "evt-anil-departed" })];
    const calls: unknown[][] = [];
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(TripActivity, mk({ rows: buildTimeline(mixed, { offsetMin: 330, me: "u1", names: { u2: "Anil" } }), correct: async (...a) => { calls.push(a); } }))); });
    expect(r.root.findAll((n) => n.type === "button" && flat(n) === "Correct this")).toHaveLength(1);
    await press(r, "Correct this");
    expect(flat(r.root)).toContain("The original stays in your history, marked as corrected.");
    await act(async () => { r.root.findByType(TimePicker).props.onChange("07:15"); });
    await press(r, "Save the time");
    expect(calls).toEqual([[mixed[0].clientEventId, "retime", "2026-11-02T01:45:00.000Z"]]);
    await press(r, "Correct this"); await press(r, "This didn't happen");
    expect(calls[1]).toEqual([mixed[0].clientEventId, "void", undefined]);
    await act(async () => { r.unmount(); });
  });
  it("a corrected line stays visible, marked, and offers no second correction", () => {
    const dep = events[0];
    const x = renderToStaticMarkup(createElement(TripActivity, mk({ correct: async () => {}, rows: buildTimeline([...events, ev("manual_correction", "2026-11-02T06:00:00Z", { meta: { target: dep.clientEventId, action: "void" } })], { offsetMin: 330, me: "u1" }) })));
    expect(x).toContain("You marked this as a mistake, so it doesn&#x27;t count."); expect((x.match(/Correct this/g) ?? []).length).toBe(2); // the other two lines
  });
});

describe("How I like to travel", () => {
  it("explains what each choice really does and where it is saved", () => {
    const x = renderToStaticMarkup(createElement(TravelPrefsCard, { prefs: DEFAULT_PREFS, onChange: () => {} }));
    expect(x).toContain("How I like to travel"); expect(x).toContain("Balanced pace · night driving off");
    expect(x).toContain("this phone only"); expect(x).toContain("not on your other devices"); expect(x).toContain("Hill roads after dark are never suggested, whatever you choose.");
    expect(x).toContain("We never change your plan because of these"); expect(x).toContain("Days run about 8 AM to 8 PM.");
    expect(x).toContain("We&#x27;ll avoid suggesting late arrivals.");
  });
  it("each pace says what it does, with real day hours", () => {
    expect(renderToStaticMarkup(createElement(TravelPrefsCard, { prefs: { ...DEFAULT_PREFS, pace: "relaxed" }, onChange: () => {} }))).toContain("Days run about 9 AM to 6:30 PM.");
    expect(renderToStaticMarkup(createElement(TravelPrefsCard, { prefs: { ...DEFAULT_PREFS, pace: "brisk", nightDriving: true }, onChange: () => {} }))).toContain("Days run about 7 AM to 9 PM.");
    expect(renderToStaticMarkup(createElement(TravelPrefsCard, { prefs: { ...DEFAULT_PREFS, nightDriving: true }, onChange: () => {} }))).toContain("Late arrivals can be suggested.");
  });
  it("changing night driving or pace tells the page exactly what changed, nothing else", async () => {
    const seen: unknown[] = [];
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(TravelPrefsCard, { prefs: DEFAULT_PREFS, onChange: (p) => seen.push(p) })); });
    await act(async () => { r.root.findByProps({ role: "switch" }).props.onClick(); });
    await press(r, "Relaxed");
    expect(seen).toEqual([{ nightDriving: true }, { pace: "relaxed" }]);
    expect(r.root.findByProps({ role: "switch" }).props["aria-checked"]).toBe(false);
    await act(async () => { r.unmount(); });
  });
});

describe("a proposal's identity (the same situation is one suggestion)", () => {
  const k = { strategy: "extend" as const, baseRev: 1, signature: "3:abc", commitSig: "0:0", nightDriving: false, pace: "balanced", keep: ["a", "b"], drop: [], pins: undefined, fuelPercent: null, journey: "awaiting-departure", nowDay: 1, bucket: 5 };
  it("is the same however the lists are ordered, and changes with anything that changes the answer", () => {
    expect(proposalKey(k)).toBe(proposalKey({ ...k, keep: ["b", "a"] }));
    for (const change of [{ strategy: "shift" as const }, { baseRev: 2 }, { signature: "3:abd" }, { commitSig: "1:x" }, { nightDriving: true }, { pace: "brisk" }, { keep: ["a"] }, { drop: ["c"] }, { fuelPercent: 40 }, { journey: "travelling" }, { nowDay: 2 }, { bucket: 6 }]) expect(proposalKey({ ...k, ...change })).not.toBe(proposalKey(k));
  });
  it("a three-hour window: inside it the same suggestion is reused, after it a fresh look is taken", () => {
    const t = Date.parse("2026-11-04T10:00:00Z");
    expect(proposalBucket(t)).toBe(proposalBucket(t + 60_000));
    expect(proposalBucket(t)).not.toBe(proposalBucket(t + PROPOSAL_REUSE_MS));
  });
});
