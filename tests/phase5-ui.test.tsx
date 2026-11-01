// Phase 5 on the phone: bookings (what is a promise and what is only your word), the group's individual journeys, your own preferences, and
// correcting your own history. Everything the traveller reads, and every control, with the rules they rest on.
import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { CommitmentsCard } from "@/components/CommitmentsCard";
import { GroupProgressCard } from "@/components/GroupProgressCard";
import { TravelPrefsCard } from "@/components/TravelPrefsCard";
import { JourneyCard } from "@/components/JourneyCard";
import type { Commitment, NewCommitment } from "@/lib/client/use-commitments";
import { memberProgress } from "@/lib/trip/group";
import { allowedActions, buildTimeline, deriveJourney, type JourneyEvent } from "@/lib/trip/journey";
import { DEFAULT_PREFS } from "@/lib/trip/preferences";

afterEach(() => vi.useRealTimers());
const flat = (n: TestRenderer.ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(flat).join(""));
const textOf = (r: TestRenderer.ReactTestRenderer) => flat(r.root);
const button = (r: TestRenderer.ReactTestRenderer, label: string) => r.root.findAll((n) => n.type === "button" && flat(n).includes(label))[0];
const press = async (r: TestRenderer.ReactTestRenderer, label: string) => { await act(async () => { button(r, label).props.onClick(); }); };

const booking = (o: Partial<Commitment> = {}): Commitment => ({ id: "c1", trip_id: "t", place_id: "p1", label: "Hotel Sai Residency", kind: "hotel", constraint_class: "fixed", day: 3, earliest_min: null, latest_min: null, source: "user_entered", reference: null, notes: null, created_by: "u1", ...o });
const noop = async () => true;
const cprops = (o: Partial<Parameters<typeof CommitmentsCard>[0]> = {}) => ({ list: [] as Commitment[], stored: true as boolean | null, error: null, busy: false, stops: [{ id: "p1", name: "Visakhapatnam", day: 3 }], numDays: 5, userId: "u1", isOwner: false, onAdd: noop, onConfirmed: noop, onRemove: noop, ...o });
const chtml = (o: Partial<Parameters<typeof CommitmentsCard>[0]> = {}) => renderToStaticMarkup(createElement(CommitmentsCard, cprops(o)));

describe("bookings", () => {
  it("says a saved place isn't a booking, and what confirmed does", () => {
    const h = chtml();
    expect(h).toContain("My bookings (0)"); expect(h).toContain("A place you saved isn&#x27;t a booking"); expect(h).toContain("Confirmed bookings are never moved; the others only get a warning");
    expect(h).toContain("Add a booking");
  });
  it("each booking says whether it is confirmed or only the traveller's word, what it protects, and its window", () => {
    const h = chtml({ list: [booking({ source: "confirmed", reference: "SR-77" }), booking({ id: "c2", label: "Temple darshan", kind: "ticket", constraint_class: "time_sensitive", earliest_min: 9 * 60, latest_min: 10 * 60 + 30, place_id: null, source: "user_entered" })] });
    expect(h).toContain("Confirmed"); expect(h).toContain("Your word"); expect(h).toContain("the day can&#x27;t move"); expect(h).toContain("arrive from 9:00 AM by 10:30 AM");
    expect(h).toContain("Hotel · Day 3 · Visakhapatnam"); expect(h).toContain("ref SR-77");
  });
  it("a document-derived booking says it is not confirmed", () => {
    expect(chtml({ list: [booking({ source: "imported" })] })).toContain("From a document, not confirmed");
  });
  it("only the person who entered a booking (or the owner) sees the controls for it", () => {
    const list = [booking({ created_by: "u2" })];
    expect(chtml({ list })).not.toContain("It&#x27;s confirmed"); expect(chtml({ list })).not.toContain("Remove");
    expect(chtml({ list, isOwner: true })).toContain("It&#x27;s confirmed");
    expect(chtml({ list: [booking({ source: "confirmed" })] })).toContain("It&#x27;s not confirmed");
  });
  it("a database without the table, and a refused save, are said plainly", () => {
    expect(chtml({ stored: false })).toContain("can&#x27;t be saved to the trip yet");
    expect(chtml({ error: "Bookings need a database update that hasn't been applied yet." })).toContain("database update");
  });
  it("adding: needs a name; saves exactly what was said (confirmed only if ticked, a time window only for a timed one); the form closes on success", async () => {
    const added: NewCommitment[] = [];
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(CommitmentsCard, cprops({ onAdd: async (c) => { added.push(c); return true; } }))); });
    await press(r, "Add a booking");
    const form = r.root.findByType("form");
    await act(async () => { form.props.onSubmit({ preventDefault() {} }); });
    expect(added).toEqual([]);                                   // no name: nothing sent
    await act(async () => { r.root.findAllByType("input").find((i) => i.props.maxLength === 80)!.props.onChange({ target: { value: "  Hotel Sai Residency  " } }); });
    await act(async () => { form.props.onSubmit({ preventDefault() {} }); });
    expect(added).toEqual([{ label: "Hotel Sai Residency", kind: "hotel", constraint_class: "fixed", day: 1, place_id: null, confirmed: false, earliest_min: null, latest_min: null, reference: null }]);
    expect(textOf(r)).not.toContain("Save booking");             // closed again
    act(() => r.unmount());
  });
  it("the form says what 'confirmed' means, and that the day can't move or the window applies", async () => {
    const h = chtml({ initiallyAdding: true });
    expect(h).toContain("The day can&#x27;t move"); expect(h).toContain("I must arrive in a time window"); expect(h).toContain("confirmed with the hotel, venue or provider"); expect(h).toContain("Confirmed bookings are never moved");
    expect(h).toContain("min-h-11");
  });
  it("a failed save keeps the form open so nothing typed is lost", async () => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(CommitmentsCard, cprops({ onAdd: async () => false }))); });
    await press(r, "Add a booking");
    await act(async () => { r.root.findAllByType("input").find((i) => i.props.maxLength === 80)!.props.onChange({ target: { value: "Hotel" } }); });
    await act(async () => { r.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    expect(textOf(r)).toContain("Save booking");
    act(() => r.unmount());
  });
});

const ev = (kind: JourneyEvent["kind"], at: string, userId: string, o: Partial<JourneyEvent> = {}): JourneyEvent => ({ clientEventId: `evt-${kind}-${userId}-${at}`.slice(0, 48), kind, occurredAt: at, source: "manual", userId, ...o });
describe("the group", () => {
  const members = [{ user_id: "u1", display_name: "Bhanu" }, { user_id: "u2", display_name: "Anil" }];
  const events = [ev("departed", "2026-11-02T16:30:00Z", "u1"), ev("arrived", "2026-11-02T20:30:00Z", "u1", { placeId: "v", placeName: "Vijayawada" }), ev("departed", "2026-11-03T00:30:00Z", "u2"), ev("paused", "2026-11-03T02:30:00Z", "u2"), ev("visit_completed", "2026-11-03T05:00:00Z", "u1", { placeId: "k" })];
  const html = (m = members) => renderToStaticMarkup(createElement(GroupProgressCard, { members: memberProgress(events, m, "u1"), offsetMin: 330 }));
  it("shows each person's own journey, not the group's", () => {
    const h = html();
    expect(h).toContain("The group (2)"); expect(h).toContain("Bhanu (you)"); expect(h).toContain("On the road since 10:00 PM, Mon 2 Nov"); expect(h).toContain("at Vijayawada since 2:00 AM");
    expect(h).toContain("Anil"); expect(h).toContain("Paused since 8:00 AM, Tue 3 Nov"); expect(h).toContain("1 visited by them");
  });
  it("says what is shared and what is not, and that it never shows where anyone is", () => {
    const h = html();
    expect(h).toContain("someone arriving or pausing doesn&#x27;t mean everyone has"); expect(h).toContain("Marking a stop done is for the whole group"); expect(h).toContain("never where anyone is");
  });
  it("a trip of one person shows nothing", () => { expect(html([members[0]])).toBe(""); });
});

describe("how I like to travel", () => {
  it("is the traveller's own, saved on the phone, and says hill roads after dark are never suggested", () => {
    const h = renderToStaticMarkup(createElement(TravelPrefsCard, { prefs: DEFAULT_PREFS, onChange: () => {} }));
    expect(h).toContain("How I like to travel"); expect(h).toContain("Hill roads after dark are never suggested either way"); expect(h).toContain("We never change these for you"); expect(h).toContain("min-h-11");
    expect(h).toContain("Balanced"); expect(h).not.toContain("checked");
  });
  it("changing night driving or pace tells the page exactly what changed, nothing else", async () => {
    const seen: unknown[] = [];
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(TravelPrefsCard, { prefs: DEFAULT_PREFS, onChange: (p) => seen.push(p) })); });
    await act(async () => { r.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }); });
    await act(async () => { r.root.findByType("select").props.onChange({ target: { value: "relaxed" } }); });
    expect(seen).toEqual([{ nightDriving: true }, { pace: "relaxed" }]);
    act(() => r.unmount());
  });
});

describe("correcting your own history on the journey card", () => {
  const events: JourneyEvent[] = [ev("departed", "2026-11-02T16:30:00Z", "u1"), ev("arrived", "2026-11-02T20:30:00Z", "u1", { placeId: "v", placeName: "Vijayawada" }), ev("departed", "2026-11-02T17:00:00Z", "u2")];
  const props = (o: Partial<Parameters<typeof JourneyCard>[0]> = {}) => {
    const mine = events.filter((e) => e.userId === "u1");
    const journey = deriveJourney(mine);
    return { journey, actions: allowedActions(journey.state), rows: buildTimeline(events, { offsetMin: 330, me: "u1", names: { u2: "Anil" } }), record: async () => "saved" as const, fix: { source: "manual" as const }, waiting: 0, stored: true as boolean | null, closed: false, offsetMin: 330, ...o };
  };
  const open = (html: string) => html.replace("<details", "<details open");

  it("your own events offer 'Correct this'; other people's do not", () => {
    const h = open(renderToStaticMarkup(createElement(JourneyCard, props({ correct: async () => {} }))));
    expect((h.match(/Correct this/g) ?? []).length).toBe(2);   // my two events, not Anil's
  });
  it("without the control nothing is offered", () => {
    expect(open(renderToStaticMarkup(createElement(JourneyCard, props())))).not.toContain("Correct this");
  });
  it("a corrected event stays on the timeline, marked, and offers no second correction", () => {
    const dep = events[0];
    const rows = buildTimeline([...events, ev("manual_correction", "2026-11-02T21:00:00Z", "u1", { meta: { target: dep.clientEventId, action: "void" } })], { offsetMin: 330, me: "u1" });
    const h = open(renderToStaticMarkup(createElement(JourneyCard, props({ rows, correct: async () => {} }))));
    expect(h).toContain("You marked this as a mistake, so it doesn&#x27;t count."); expect((h.match(/Correct this/g) ?? []).length).toBe(1);
  });
  it("correcting the time sends that event, 'retime', and the real time on the same India date; the original is promised to stay", async () => {
    const calls: [string, string, string | undefined][] = [];
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(JourneyCard, props({ correct: async (t, a, at) => { calls.push([t, a, at]); } }))); });
    await press(r, "Correct this");
    expect(textOf(r)).toContain("What time was it really?"); expect(textOf(r)).toContain("The original stays in your history, marked as corrected.");
    await act(async () => { r.root.findByProps({ type: "time" }).props.onChange({ target: { value: "21:15" } }); });
    await press(r, "Save the time");
    expect(calls).toEqual([[events[0].clientEventId, "retime", "2026-11-02T15:45:00.000Z"]]); // 9:15 PM IST
    act(() => r.unmount());
  });
  it("'This didn't happen' voids that event; Cancel sends nothing", async () => {
    const calls: unknown[][] = [];
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(JourneyCard, props({ correct: async (...a) => { calls.push(a); } }))); });
    await press(r, "Correct this"); await press(r, "Cancel");
    expect(calls).toEqual([]);
    await press(r, "Correct this"); await press(r, "This didn't happen");
    expect(calls).toEqual([[events[0].clientEventId, "void", undefined]]);
    act(() => r.unmount());
  });
  it("why a correction was refused is shown next to the controls", () => {
    const h = renderToStaticMarkup(createElement(JourneyCard, props({ correct: async () => {}, problem: "Journey: manual correction couldn't be sent: Other events depend on this one. Correct those first." })));
    expect(h).toContain("Other events depend on this one. Correct those first.");
  });
});
