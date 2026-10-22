import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripCheck } from "@/components/TripCheck";
import type { Place, Trip } from "@/lib/types";
import { openIntervals, validateHours } from "@/lib/server/opening-hours";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const trip = (o: Partial<Trip> = {}): Trip => ({ id: "t1", owner_id: "u1", name: "Vizag", start_city: "Hyderabad", start_lat: 17.385, start_lng: 78.4867, dest_name: "Visakhapatnam", dest_lat: 17.69, dest_lng: 83.2, start_date: "2026-10-14", num_days: 3, invite_code: "x", created_at: "", ...o } as Trip);
const place = (o: Partial<Place> = {}): Place => ({ id: "p1", trip_id: "t1", name: "Bhongir Fort", lat: 17.51, lng: 78.88, source_type: "manual", source_url: null, season_tag_id: null, day_number: 1, sequence_order: 1, arrival_time: "10:00:00", notes: null, added_by: null, created_at: "", category: "fort", address: null, drive_minutes: 105, drive_km: 48, status: "planned", status_at: null, priority: null, visit_minutes: 60, ...o } as Place);
const KEY = "tm:trip-check:t1";

const html = (t: Trip, places: Place[]) => renderToStaticMarkup(createElement(TripCheck, { tripId: "t1", trip: t, places, activeDay: 1, today: "2026-10-12" }));

describe("TripCheck — first screen", () => {
  it("a trip with no dates says so, what that limits, and how to fix it", () => {
    const h = html(trip({ start_date: null }), [place()]);
    expect(h).toContain("When should I leave?"); expect(h).toContain("Trip dates aren&#x27;t set");
    expect(h).toContain("Set them to check destination opening hours, weather forecasts, estimated arrival times and travel conditions.");
    expect(h).toContain("Limits: season scores, weather, opening hours, day labels"); expect(h).toContain("Set trip dates");
  });
  it("a trip with dates and no other limits is simply ready, and hours we don't know are not a 'limit'", () => {
    const h = html(trip(), [place()]);
    expect(h).not.toContain("Limits:"); expect(h).not.toContain("Trip dates aren");
  });
  it("nothing is checked until the traveller asks (no results, no alerts yet)", () => {
    const h = html(trip(), [place()]);
    expect(h).not.toContain("Alerts for this trip"); expect(h).not.toContain("Nothing in the stops we could check looks");
    expect(h).toContain("When should I leave?"); expect(h).toContain("Find the best time to leave"); expect(h).not.toContain("Check my departure");
  });
  it("is honest about what it assumes: car, India time, no live traffic, and that it only suggests", () => {
    const h = html(trip(), [place()]);
    expect(h).toContain("India time"); expect(h).toContain("no live traffic"); expect(h).toContain("it never changes your plan");
  });
});

describe("TripCheck — checking a departure", () => {
  let store: Record<string, string>;
  let calls: { url: string; method: string; body: unknown }[];
  let hoursFails: boolean;
  let etaFails: boolean;
  let etaSource: string;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T06:00:00Z")); // 11:30 in India
    store = {}; calls = []; hoursFails = false; etaFails = false; etaSource = "osrm";
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } }, addEventListener: () => undefined, removeEventListener: () => undefined, setTimeout: () => 0 });
    vi.stubGlobal("document", { getElementById: () => null });
    // The server side, for real: /hours expands the stops' hours with the actual opening_hours parser; PATCH validates with it too.
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method, body });
      const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });
      if (url.startsWith("/api/trips/t1/hours?")) {
        if (hoursFails) return json({ error: "boom" }, 500);
        const date = new URL(url, "https://x").searchParams.get("date")!;
        const mid = Date.parse(`${date}T00:00:00+05:30`);
        const fromMs = mid - DAY, toMs = mid + 3 * DAY;
        const stops = Object.fromEntries(serverPlaces.filter((p) => p.opening_hours).map((p) => [p.id, openIntervals(p.opening_hours!, fromMs, toMs, 330, p)]));
        return json({ fromMs, toMs, utcOffsetMin: 330, stops });
      }
      if (url === "/api/eta") {
        if (etaFails) return json({ error: "Too many route updates today. Please try again tomorrow." }, 429);
        return json({ legs: (body.points as unknown[]).slice(1).map(() => ({ minutes: 90, km: 100 })), line: [], source: etaSource });
      }
      if (url.startsWith("/api/places/") && method === "PATCH") {
        const h = body.hours;
        if ("confirm" in h) return json({ ok: true, opening_hours: "Mo-Su 09:00-18:00", hours_source: "map_data", hours_ref: "osm/node/1", hours_fetched_at: null, hours_confirmed_at: "2026-10-12T06:00:00Z", warnings: [] });
        if (h.value === null) return json({ ok: true, opening_hours: null, hours_source: null, hours_ref: null, hours_fetched_at: null, hours_confirmed_at: null, warnings: [] });
        const v = validateHours(h.value);
        if (!v.ok) return json({ error: v.reason }, 422);
        return json({ ok: true, opening_hours: v.value, hours_source: "traveller", hours_ref: null, hours_fetched_at: null, hours_confirmed_at: "2026-10-12T06:00:00Z", warnings: v.warnings });
      }
      return json({ error: "unexpected" }, 404);
    }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const DAY = 24 * 3_600_000;
  let serverPlaces: Place[] = [];
  const saved = (o: object) => { store[KEY] = JSON.stringify({ date: "2026-10-14", time: "21:00", day: 1, ran: true, hours: {}, states: {}, seen: {}, ...o }); };
  /** A stop whose hours are stored on the trip (typed by a member unless said otherwise). */
  const withHours = (hours = "Mo-Su 09:00-18:00", source: "traveller" | "map_data" = "traveller", confirmed = source === "traveller", o: Partial<Place> = {}) =>
    place({ opening_hours: hours, hours_source: source, hours_confirmed_at: confirmed ? "2026-10-10T06:00:00Z" : null, ...o });
  let r: TestRenderer.ReactTestRenderer;
  const mount = async (t = trip(), places = [place()]) => {
    serverPlaces = places;
    await act(async () => { r = TestRenderer.create(createElement(TripCheck, { tripId: "t1", trip: t, places, activeDay: 1, today: "2026-10-12" })); });
    await act(async () => {}); // let the hours request finish
  };
  afterEach(() => { act(() => r?.unmount()); });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- walking the renderer's own tree
  const textOf = (j: any): string => (j == null ? "" : typeof j === "string" ? j : Array.isArray(j) ? j.map(textOf).join("") : (j.children ?? []).map(textOf).join(""));
  const page = () => textOf(r.toJSON());
  // The visible words inside a React element's children (never JSON.stringify them: elements point back at the renderer).
  const propText = (c: unknown): string => (c == null || typeof c === "boolean" ? "" : typeof c === "string" || typeof c === "number" ? String(c) : Array.isArray(c) ? c.map(propText).join("") : typeof c === "object" && "props" in (c as object) ? propText((c as { props: { children?: unknown } }).props.children) : "");
  const clickText = async (label: string) => {
    const el = r.root.findAll((n) => n.type === "button" && propText(n.props.children).includes(label))[0];
    if (!el) throw new Error(`no button "${label}" in: ${page().slice(0, 300)}`);
    await act(async () => { el.props.onClick(); });
    await act(async () => {});
  };
  const blur = async (value: string) => {
    await act(async () => { r.root.findByProps({ id: "hours-p1" }).props.onBlur({ target: { value } }); });
    await act(async () => {});
  };

  it("leaving at 21:00 for a fort a trip member says closes at 6 PM: says it is likely closed, with arrival time, and why", async () => {
    saved({}); await mount(trip(), [withHours()]);
    const p = page();
    expect(p).toContain("Likely closed when you arrive"); expect(p).toContain("arrive about 10:45 PM"); expect(p).toContain("closes at 6:00 PM"); expect(p).toContain("Likely closed"); expect(p).toContain("Based on hours entered by a trip member.");
    expect(p).toContain("1 stop needs a look.");
    expect(p).toContain("Opening hours don't guarantee entry");
  });
  it("the hours are read on the server for the chosen date (the parser never runs in the browser)", async () => {
    saved({}); await mount(trip(), [withHours()]);
    expect(calls.some((c) => c.url === "/api/trips/t1/hours?date=2026-10-14")).toBe(true);
  });
  it("the fix is a button that only changes the what-if time, not the trip", async () => {
    saved({}); await mount(trip(), [withHours()]);
    await clickText("Try leaving");
    const after = JSON.parse(store[KEY]);
    expect(`${after.date} ${after.time}`).not.toBe("2026-10-14 21:00"); expect(after.ran).toBe(true);
    expect(page()).not.toContain("Likely closed when you arrive"); // leaving early enough fixes it
    expect(calls.some((c) => c.method === "PATCH")).toBe(false); // the trip itself was not changed
  });
  it("the problem becomes an alert with what it means and what to do, and it can be dismissed", async () => {
    saved({}); await mount(trip(), [withHours()]);
    expect(page()).toContain("Alerts for this trip"); expect(page()).toContain("Bhongir Fort: likely closed when you arrive"); expect(page()).toContain("Leave earlier");
    await clickText("Dismiss");
    expect(page()).not.toContain("Alerts for this trip"); expect(page()).toContain("Dismissed and snoozed alerts (1)"); expect(page()).toContain("dismissed");
    expect(JSON.parse(store[KEY]).states["arrival_after_closing:t1:p1"].dismissedAtSeverity).toBe("high");
  });
  it("a dismissed alert can be brought back", async () => {
    saved({}); await mount(trip(), [withHours()]);
    await clickText("Dismiss"); await clickText("Show again");
    expect(page()).toContain("Alerts for this trip");
  });
  it("an alert can be snoozed; the snooze is saved with a time", async () => {
    saved({}); await mount(trip(), [withHours()]);
    await clickText("Remind me in 2 hours");
    expect(JSON.parse(store[KEY]).states["arrival_after_closing:t1:p1"].snoozedUntil).toBeGreaterThan(Date.now());
    expect(page()).toContain("snoozed");
  });
  it("with NO hours, nothing is called closed: it says 'hours unavailable' and raises no alert (acceptance)", async () => {
    saved({}); await mount();
    const p = page();
    expect(p).toContain("Hours unavailable"); expect(p).toContain("can't say whether it will be open");
    expect(p).not.toContain("Likely closed"); expect(p).not.toContain("Alerts for this trip");
    expect(p).toContain("1 stop has no hours we can check.");
    expect(p).toContain("We can't tell yet whether your stops will be open."); expect(p).not.toContain("Nothing in the stops we could check looks impractical"); // not an all-clear
    expect(p).toContain("Add its opening hours");
    expect(calls.filter((c) => !c.url.startsWith("/api/weather"))).toHaveLength(0); // no hours on the day: nothing to ask the server about hours (the weather at the arrival times is fetched separately)
  });
  it("hours that are fine produce a calm 'nothing looks impractical' and no alert", async () => {
    saved({ time: "10:00" }); await mount(trip(), [withHours("24/7")]);
    expect(page()).toContain("Nothing in the stops we could check looks impractical at this time."); expect(page()).not.toContain("Alerts for this trip");
  });
  it("a weekly closing day is judged on the actual weekday", async () => {
    // 2026-10-14 is a Wednesday. Closed on Wednesdays: leaving at 10:00 must say closed that day, not 'unverified'.
    saved({ time: "10:00" }); await mount(trip(), [withHours("Mo-Su 09:00-18:00; We off")]);
    expect(page()).toContain("Closed that day");
  });
  it("seasonal hours (months), which the old basic reader could only call 'unverified', are now judged", async () => {
    // October falls in the Oct-Mar season (09:00-18:00): arriving ~11:45 is open, and the closing time is the season's.
    saved({ time: "10:00" }); await mount(trip(), [withHours("Apr-Sep 10:00-17:00; Oct-Mar 09:00-18:00")]);
    const p = page();
    expect(p).toContain("Open when you arrive"); expect(p).toContain("open until 6:00 PM");
  });
  it("hours that depend on public holidays are 'unable to verify', never treated as an ordinary day", async () => {
    saved({ time: "10:00" }); await mount(trip(), [withHours("Mo-Su 09:00-18:00; PH off")]);
    const p = page();
    expect(p).toContain("Unable to verify the hours"); expect(p).toContain("Indian holiday calendar"); expect(p).not.toContain("Open when you arrive");
  });
  it("hours from map data that nobody confirmed: the problem is shown, labelled, and never raised to the highest alarm", async () => {
    saved({}); await mount(trip(), [withHours("Mo-Su 09:00-18:00", "map_data", false)]);
    const p = page();
    expect(p).toContain("Likely closed when you arrive"); expect(p).toContain("haven't been confirmed"); expect(p).toContain("Based on map data (OpenStreetMap), not confirmed.");
    const alert = r.root.findAll((n) => n.type === "li" && n.props.role === "alert");
    expect(alert).toHaveLength(0); // softened: no urgent alert from unconfirmed map data alone
  });
  it("confirming map-data hours asks the server, and the result then counts as confirmed", async () => {
    saved({ ran: false }); await mount(trip(), [withHours("Mo-Su 09:00-18:00", "map_data", false)]);
    await clickText("Opening hours for this day");
    expect(page()).toContain("From map data (OpenStreetMap)"); expect(page()).toContain("Not confirmed yet");
    await clickText("These hours are right");
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ url: "/api/places/p1", body: { hours: { confirm: true } } });
    expect(page()).toContain("confirmed by a trip member");
  });
  it("if the hours can't be loaded, the check says so instead of guessing", async () => {
    hoursFails = true; saved({}); await mount(trip(), [withHours()]);
    const p = page();
    expect(p).toContain("couldn't load the opening hours"); expect(p).not.toContain("Likely closed"); expect(p).not.toContain("Open when you arrive");
  });
  it("a missing departure time stops the check and says what is needed, instead of guessing one", async () => {
    saved({ time: "" }); await mount();
    const p = page();
    expect(p).toContain("Needs 1 thing first"); expect(p).toContain("Choose the time you plan to leave"); expect(p).not.toContain("arrive 2");
  });
  it("missing driving times are fetched from the road router for this day, not a dead end", async () => {
    saved({ time: "09:00" }); await mount(trip(), [withHours("Mo-Su 09:00-18:00", "traveller", true, { drive_minutes: null })]);
    const eta = calls.filter((c) => c.url === "/api/eta");
    expect(eta).toHaveLength(1);
    expect((eta[0].body as { points: { lat: number }[] }).points).toHaveLength(2); // the trip start, then the stop
    expect(page()).not.toContain("Some stops have no driving time yet");
    expect(page()).toContain("arrive about 10:30 AM"); // 9:00 + 90 min of road time
    expect(page()).toContain("Likely open");
  });
  it("'Find the best time to leave' does something visible: it gets road times, recommends a time and explains it", async () => {
    saved({ ran: false, time: "" }); await mount(trip(), [withHours("Mo-Su 09:00-18:00", "traveller", true, { drive_minutes: null })]);
    expect(page()).not.toContain("Best time to leave");
    await clickText("Find the best time to leave");
    const p = page();
    expect(calls.some((c) => c.url === "/api/eta")).toBe(true);
    expect(p).toContain("Best time to leave"); expect(p).toMatch(/Leave at \d{1,2}:\d{2} (AM|PM)/);
    expect(p).toContain("What this assumes"); expect(p).toContain("live traffic");
    expect(p).toContain("At that time, will each place be open when you arrive?"); expect(p).toContain("Likely open");
    expect(p).not.toMatch(/\b(1[3-9]|2[0-4]):\d{2}\b/); // no 24-hour clock anywhere on the screen
  });
  it("it uses the plan's saved driving times when it has them, and does not call the router", async () => {
    saved({ ran: false, time: "" }); await mount(trip(), [withHours("Mo-Su 09:00-18:00", "traveller", true, { drive_minutes: 60 })]);
    await clickText("Find the best time to leave");
    expect(calls.some((c) => c.url === "/api/eta")).toBe(false);
    expect(page()).toContain("Leave at");
    expect(page()).toContain("saved plan");
  });
  it("when road routing is down the answer is labelled a straight-line estimate", async () => {
    etaSource = "estimate";
    saved({ ran: false, time: "" }); await mount(trip(), [withHours("Mo-Su 09:00-18:00", "traveller", true, { drive_minutes: null })]);
    await clickText("Find the best time to leave");
    expect(page()).toContain("straight-line estimates");
  });
  it("if driving times can't be fetched it says why and shows no made-up time", async () => {
    etaFails = true;
    saved({ ran: false, time: "" }); await mount(trip(), [withHours("Mo-Su 09:00-18:00", "traveller", true, { drive_minutes: null })]);
    await clickText("Find the best time to leave");
    expect(page()).toContain("Too many route updates today");
    expect(page()).not.toMatch(/Leave at \d/);
  });
  it("with no opening hours known it says the time comes from the length of the day only", async () => {
    saved({ ran: false, time: "" }); await mount(trip(), [place({ drive_minutes: 60 })]);
    await clickText("Find the best time to leave");
    expect(page()).toContain("A sensible time to leave"); expect(page()).toContain("We don't know the opening hours of any stop");
    expect(page()).toContain("Unable to verify");
  });
  it("a day with no stops says there is nothing to time", async () => {
    saved({ ran: false, time: "", day: 2 }); await mount(trip(), [place()]);
    await clickText("Find the best time to leave");
    expect(page()).toContain("no stops on Day 2");
  });
  it("without any date it asks for one instead of guessing", async () => {
    saved({ ran: false, time: "", date: "" }); await mount(trip({ start_date: null }), [place({ drive_minutes: 60 })]);
    await clickText("Find the best time to leave");
    expect(page()).toContain("Choose a date first");
  });
  it("when no start time can work it says so instead of a false all-clear", async () => {
    saved({ ran: false, time: "" }); await mount(trip(), [withHours("Mo-Su 09:00-17:00", "traveller", true, { drive_minutes: 660, visit_minutes: 120 })]);
    await clickText("Find the best time to leave");
    expect(page()).toContain("No start time makes every place work");
  });
  it("a trip with no dates can still be checked when a date is typed into the check", async () => {
    saved({ date: "2026-10-14" }); await mount(trip({ start_date: null }), [withHours()]);
    expect(page()).toContain("Likely closed when you arrive");
  });
  it("typed hours: an ambiguous entry is refused here with a reason; a good one is saved ON THE TRIP via the server", async () => {
    saved({ ran: false }); await mount();
    await clickText("Opening hours for this day");
    await blur("9-6");
    expect(page()).toContain("Add am or pm");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    await blur("9am-6pm");
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ url: "/api/places/p1", body: { hours: { value: "Mo-Su 09:00-18:00" } } });
    expect(page()).not.toContain("Add am or pm"); expect(page()).toContain("Entered by a trip member");
  });
  it("text the server can't read is refused with the server's reason, and nothing is stored", async () => {
    saved({ ran: false }); await mount();
    await clickText("Opening hours for this day");
    await blur("open whenever the priest is around");
    expect(page()).toContain("We couldn't read these opening hours");
    expect(page()).not.toContain("Entered by a trip member");
  });
  it("clearing the hours removes them on the trip (we go back to 'unavailable')", async () => {
    saved({ ran: false }); await mount(trip(), [withHours()]);
    await clickText("Opening hours for this day");
    await blur("");
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ body: { hours: { value: null } } });
  });
  it("hours typed on this device before they were saved to trips are offered for saving, and no longer used by the check", async () => {
    saved({ hours: { p1: { hours: "Mo-Su 09:00-18:00", typed: "9am-6pm", at: Date.now() } } }); await mount();
    expect(page()).toContain("Hours unavailable"); // the device-only copy is not used
    await clickText("Opening hours for this day");
    expect(page()).toContain("kept only on this device");
    await clickText("Save “9am-6pm” to the trip");
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ body: { hours: { value: "Mo-Su 09:00-18:00" } } });
    expect(JSON.parse(store[KEY]).hours).toEqual({}); // the local copy is gone once it is on the trip
  });
  it("damaged saved data never breaks the card", async () => {
    store[KEY] = "{not json"; await mount();
    expect(page()).toContain("When should I leave?");
  });
  it("the check only looks at the chosen day's stops", async () => {
    saved({ day: 2 }); await mount(trip(), [withHours(), place({ id: "p2", name: "Other", day_number: 2 })]);
    expect(page()).toContain("Other"); expect(page()).not.toContain("Bhongir Fort");
  });
});
