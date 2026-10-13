import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripCheck } from "@/components/TripCheck";
import type { Place, Trip } from "@/lib/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const trip = (o: Partial<Trip> = {}): Trip => ({ id: "t1", owner_id: "u1", name: "Vizag", start_city: "Hyderabad", start_lat: 17.385, start_lng: 78.4867, dest_name: "Visakhapatnam", dest_lat: 17.69, dest_lng: 83.2, start_date: "2026-10-14", num_days: 3, invite_code: "x", created_at: "", ...o } as Trip);
const place = (o: Partial<Place> = {}): Place => ({ id: "p1", trip_id: "t1", name: "Bhongir Fort", lat: 17.51, lng: 78.88, source_type: "manual", source_url: null, season_tag_id: null, day_number: 1, sequence_order: 1, arrival_time: "10:00:00", notes: null, added_by: null, created_at: "", category: "fort", address: null, drive_minutes: 105, drive_km: 48, status: "planned", status_at: null, priority: null, visit_minutes: 60, ...o } as Place);
const KEY = "tm:trip-check:t1";

const html = (t: Trip, places: Place[]) => renderToStaticMarkup(createElement(TripCheck, { tripId: "t1", trip: t, places, activeDay: 1, today: "2026-10-12" }));

describe("TripCheck — first screen", () => {
  it("a trip with no dates says so, what that limits, and how to fix it", () => {
    const h = html(trip({ start_date: null }), [place()]);
    expect(h).toContain("Trip check"); expect(h).toContain("Trip dates aren&#x27;t set");
    expect(h).toContain("Set them to check destination opening hours, weather forecasts, estimated arrival times and travel conditions.");
    expect(h).toContain("Limits: season scores, weather, opening hours, day labels"); expect(h).toContain("Set trip dates"); expect(h).toContain("Ready, with 1 limit");
  });
  it("a trip with dates and no other limits is simply ready, and hours we don't know are not a 'limit'", () => {
    const h = html(trip(), [place()]);
    expect(h).toContain(">Ready<"); expect(h).not.toContain("Limits:");
  });
  it("nothing is checked until the traveller asks (no results, no alerts yet)", () => {
    const h = html(trip(), [place()]);
    expect(h).not.toContain("Alerts for this trip"); expect(h).not.toContain("Nothing in your day looks");
    expect(h).toContain("Will it be open when I arrive?"); expect(h).toContain("Check my departure");
  });
  it("is honest about what it assumes: car, India time, no live traffic, and that it only suggests", () => {
    const h = html(trip(), [place()]);
    expect(h).toContain("India time"); expect(h).toContain("no live traffic"); expect(h).toContain("it never changes your plan");
  });
});

describe("TripCheck — checking a departure", () => {
  let store: Record<string, string>;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T06:00:00Z")); // 11:30 in India
    store = {};
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } }, addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal("document", { getElementById: () => null });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const saved = (o: object) => { store[KEY] = JSON.stringify({ date: "2026-10-14", time: "21:00", day: 1, ran: true, hours: {}, states: {}, seen: {}, ...o }); };
  const hoursFor = (typed = "9am-6pm", hours = "Mo-Su 09:00-18:00") => ({ p1: { hours, typed, at: Date.now() } });
  let r: TestRenderer.ReactTestRenderer;
  const mount = (t = trip(), places = [place()]) => { act(() => { r = TestRenderer.create(createElement(TripCheck, { tripId: "t1", trip: t, places, activeDay: 1, today: "2026-10-12" })); }); };
  afterEach(() => { act(() => r?.unmount()); });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- walking the renderer's own tree
  const textOf = (j: any): string => (j == null ? "" : typeof j === "string" ? j : Array.isArray(j) ? j.map(textOf).join("") : (j.children ?? []).map(textOf).join(""));
  const page = () => textOf(r.toJSON());
  // The visible words inside a React element's children (never JSON.stringify them: elements point back at the renderer).
  const propText = (c: unknown): string => (c == null || typeof c === "boolean" ? "" : typeof c === "string" || typeof c === "number" ? String(c) : Array.isArray(c) ? c.map(propText).join("") : typeof c === "object" && "props" in (c as object) ? propText((c as { props: { children?: unknown } }).props.children) : "");
  const clickText = (label: string) => {
    const el = r.root.findAll((n) => n.type === "button" && propText(n.props.children).includes(label))[0];
    if (!el) throw new Error(`no button "${label}" in: ${page().slice(0, 200)}`);
    act(() => { el.props.onClick(); });
  };

  it("leaving at 21:00 for a fort the traveller says closes at 6 PM: says it is likely closed, with arrival time, and why", () => {
    saved({ hours: hoursFor() }); mount();
    const p = page();
    expect(p).toContain("Likely closed when you arrive"); expect(p).toContain("arrive 22:45"); expect(p).toContain("closes at 18:00"); expect(p).toContain("Based on the hours you entered.");
    expect(p).toContain("1 stop needs a look.");
  });
  it("the fix is a button that only changes the what-if time, not the trip", () => {
    saved({ hours: hoursFor() }); mount();
    clickText("Try leaving");
    const after = JSON.parse(store[KEY]);
    expect(`${after.date} ${after.time}`).not.toBe("2026-10-14 21:00"); expect(after.ran).toBe(true);
    expect(page()).not.toContain("Likely closed when you arrive"); // leaving early enough fixes it
  });
  it("the problem becomes an alert with what it means and what to do, and it can be dismissed", () => {
    saved({ hours: hoursFor() }); mount();
    expect(page()).toContain("Alerts for this trip"); expect(page()).toContain("Bhongir Fort: likely closed when you arrive"); expect(page()).toContain("Leave earlier");
    clickText("Dismiss");
    expect(page()).not.toContain("Alerts for this trip"); expect(page()).toContain("Alert history (1)"); expect(page()).toContain("dismissed");
    expect(JSON.parse(store[KEY]).states["arrival_after_closing:t1:p1"].dismissedAtSeverity).toBe("high");
  });
  it("a dismissed alert can be brought back", () => {
    saved({ hours: hoursFor() }); mount();
    clickText("Dismiss"); clickText("Show again");
    expect(page()).toContain("Alerts for this trip");
  });
  it("an alert can be snoozed; the snooze is saved with a time", () => {
    saved({ hours: hoursFor() }); mount();
    clickText("Remind me in 2 hours");
    expect(JSON.parse(store[KEY]).states["arrival_after_closing:t1:p1"].snoozedUntil).toBeGreaterThan(Date.now());
    expect(page()).toContain("snoozed");
  });
  it("with NO hours entered, nothing is called closed: it says 'hours unverified' and raises no alert (acceptance)", () => {
    saved({ hours: {} }); mount();
    const p = page();
    expect(p).toContain("Hours unverified"); expect(p).toContain("can&#x27;t say whether it will be open".replace("&#x27;", "'"));
    expect(p).not.toContain("Likely closed"); expect(p).not.toContain("Alerts for this trip");
    expect(p).toContain("1 has no hours we can check.");
  });
  it("hours that are fine produce a calm 'nothing looks impractical' and no alert", () => {
    saved({ time: "10:00", hours: hoursFor("24 hours", "24/7") }); mount();
    expect(page()).toContain("Nothing in your day looks impractical at this time."); expect(page()).not.toContain("Alerts for this trip");
  });
  it("a missing departure time stops the check and says what is needed, instead of guessing one", () => {
    saved({ time: "" }); mount();
    const p = page();
    expect(p).toContain("Needs 1 thing first"); expect(p).toContain("Choose the time you plan to leave"); expect(p).not.toContain("arrive 2");
  });
  it("missing driving times send the traveller to Plan my trip", () => {
    saved({ time: "09:00" }); mount(trip(), [place({ drive_minutes: null })]);
    expect(page()).toContain("Some stops have no driving time yet"); expect(page()).toContain("Plan my trip");
  });
  it("a trip with no dates can still be checked when a date is typed into the check", () => {
    saved({ date: "2026-10-14", hours: hoursFor() }); mount(trip({ start_date: null }));
    expect(page()).toContain("Likely closed when you arrive");
  });
  it("opening hours the traveller types: unreadable or ambiguous entries are refused with a reason; good ones are saved", () => {
    saved({ ran: false }); mount();
    clickText("Opening hours I know");
    const input = r.root.findByProps({ id: "hours-p1" });
    act(() => { input.props.onBlur({ target: { value: "9-6" } }); });
    expect(page()).toContain("Add am or pm");
    act(() => { input.props.onBlur({ target: { value: "9am-6pm" } }); });
    expect(JSON.parse(store[KEY]).hours.p1).toMatchObject({ hours: "Mo-Su 09:00-18:00", typed: "9am-6pm" });
    expect(page()).not.toContain("Add am or pm");
  });
  it("clearing the hours removes them (we go back to 'unverified')", () => {
    saved({ ran: false, hours: hoursFor() }); mount();
    clickText("Opening hours I know");
    act(() => { r.root.findByProps({ id: "hours-p1" }).props.onBlur({ target: { value: "" } }); });
    expect(JSON.parse(store[KEY]).hours).toEqual({});
  });
  it("hours entered long ago are shown as possibly out of date (freshness is source-specific)", () => {
    saved({ ran: false, hours: { p1: { hours: "Mo-Su 09:00-18:00", typed: "9am-6pm", at: Date.now() - 400 * 24 * 3_600_000 } } }); mount();
    clickText("Opening hours I know");
    expect(page()).toContain("They may be out of date.");
  });
  it("damaged saved data never breaks the card", () => {
    store[KEY] = "{not json"; mount();
    expect(page()).toContain("Trip check");
  });
  it("the check only looks at the chosen day's stops", () => {
    saved({ hours: hoursFor(), day: 2 }); mount(trip(), [place(), place({ id: "p2", name: "Other", day_number: 2 })]);
    expect(page()).toContain("Other"); expect(page()).not.toContain("Bhongir Fort");
  });
});
