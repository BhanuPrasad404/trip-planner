// Phase 1 on the phone: journey events through the outbox (offline, retries, order), the useJourney hook against a fake phone and server,
// and what the journey card says.
import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/lib/client/stop-signal", () => ({ announceStopsChanged: async () => undefined, announceTripStatus: async () => undefined }));

import { addToOutbox, applyOutboxToPlaces, describe as describeItem, itemKey, outboxKey, parseOutbox, requestFor, type OutboxItem } from "@/lib/client/outbox";
import { useOutbox } from "@/lib/client/use-outbox";
import { journeyCacheKey, useJourney } from "@/lib/client/use-journey";
import { JourneyCard } from "@/components/JourneyCard";
import { allowedActions, buildTimeline, deriveJourney, type JourneyEvent } from "@/lib/trip/journey";
import { perUserDriveKeyPrefixes } from "@/lib/drive/persist";

const T0 = 1_800_000_000_000;
const TRIP = "trip-1";
const jr = (event: "departed" | "paused" | "resumed" | "rest_started" | "rest_ended", eventId: string, at = T0, o: Partial<Extract<OutboxItem, { kind: "journey" }>> = {}): OutboxItem => ({ kind: "journey", tripId: TRIP, event, eventId, source: "manual", at, ...o });

describe("journey events in the outbox", () => {
  it("every event is kept: two pauses are two events, never one replacing the other (unlike a stop's status)", () => {
    let items: OutboxItem[] = [];
    items = addToOutbox(items, jr("paused", "evt-00000001", T0)).items;
    items = addToOutbox(items, jr("paused", "evt-00000002", T0 + 1)).items;
    expect(items).toHaveLength(2);
    expect(new Set(items.map(itemKey)).size).toBe(2);
  });
  it("becomes a POST with the time the traveller tapped, the id, and no coordinates", () => {
    const req = requestFor(jr("departed", "evt-00000003", T0, { source: "gps", accuracyM: 12, placeName: "Vijayawada", meta: { from: "Hyderabad" } }));
    expect(req.url).toBe(`/api/trips/${TRIP}/events`);
    expect(req.init.method).toBe("POST");
    const body = JSON.parse(req.init.body as string);
    expect(body).toEqual({ kind: "departed", client_event_id: "evt-00000003", at: new Date(T0).toISOString(), source: "gps", accuracy_m: 12, place_name: "Vijayawada", meta: { from: "Hyderabad" } });
    expect(Object.keys(body).filter((k) => /lat|lng|coord|position/.test(k))).toEqual([]);
  });
  it("saved items round-trip; a damaged kind, id, source or detail drops the entry instead of sending it", () => {
    const ok = jr("rest_started", "evt-00000004");
    expect(parseOutbox(JSON.stringify({ items: [ok] }), T0 + 1000)).toEqual([ok]);
    const bad = [
      { ...ok, event: "teleported" }, { ...ok, eventId: "x" }, { ...ok, source: "system" }, { ...ok, accuracyM: -1 },
      { ...ok, meta: { a: { nested: 1 } } }, { ...ok, meta: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, 1])) }, { ...ok, tripId: "" },
    ];
    expect(parseOutbox(JSON.stringify({ items: bad }), T0 + 1000)).toEqual([]);
  });
  it("a waiting journey event never changes how a stop looks", () => {
    const places = [{ id: "p1", status: "planned", lat: 1, lng: 2 }];
    expect(applyOutboxToPlaces(places, [jr("paused", "evt-00000005")])).toBe(places);
  });
  it("describes itself for the 'couldn't be sent' message", () => {
    expect(describeItem(jr("rest_started", "evt-00000006"))).toBe("Journey: rest started");
  });
  it("the saved copy of the journey is wiped on sign-out with the rest of this person's drive data", () => {
    expect(perUserDriveKeyPrefixes("u1")).toContain("tm:journey:u1:");
    expect(journeyCacheKey("u1", "t")).toBe("tm:journey:u1:t");
  });
});

// ── The hook against a fake phone and server ──
let store: Record<string, string>; let online: boolean; let winListeners: Record<string, (() => void)[]>;
let serverEvents: JourneyEvent[]; let posts: { url: string; body: Record<string, unknown> }[]; let postReply: { status: number; body?: unknown }; let getStatus: number; let stored: boolean;
const fakeStorage = () => ({ getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; }, get length() { return Object.keys(store).length; }, key: (i: number) => Object.keys(store)[i] ?? null });

beforeEach(() => {
  store = {}; online = true; winListeners = {}; serverEvents = []; posts = []; postReply = { status: 200, body: { ok: true } }; getStatus = 200; stored = true;
  vi.useFakeTimers(); vi.setSystemTime(T0);
  vi.stubGlobal("window", {
    localStorage: fakeStorage(), confirm: vi.fn(() => true),
    addEventListener: (n: string, f: () => void) => { (winListeners[n] ??= []).push(f); }, removeEventListener: (n: string, f: () => void) => { winListeners[n] = (winListeners[n] ?? []).filter((x) => x !== f); },
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (i: number) => clearTimeout(i), setInterval: (f: () => void, ms: number) => setInterval(f, ms), clearInterval: (i: number) => clearInterval(i),
  });
  vi.stubGlobal("navigator", { get onLine() { return online; } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (!online) throw new TypeError("Failed to fetch");
    if (!init || !init.method || init.method === "GET") {
      const res = { ok: getStatus < 300, status: getStatus, json: async () => ({ ok: true, stored, events: serverEvents }), clone: () => res };
      return res;
    }
    const body = JSON.parse(String(init.body));
    posts.push({ url, body });
    if (postReply.status < 300) serverEvents.push({ clientEventId: body.client_event_id, kind: body.kind, occurredAt: body.at, source: body.source, userId: "me", meta: body.meta ?? {} });
    const res = { ok: postReply.status < 300, status: postReply.status, json: async () => postReply.body ?? {}, clone: () => res };
    return res;
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("useJourney", () => {
  let api!: ReturnType<typeof useJourney>; let r: TestRenderer.ReactTestRenderer; let closed = false;
  const Probe = () => {
    const outbox = useOutbox(TRIP, "me", () => {}, () => Date.now());
    api = useJourney({ tripId: TRIP, userId: "me", outbox, closed, offsetMin: 330, nowMs: Date.now() });
    return null;
  };
  const mount = async () => { await act(async () => { r = TestRenderer.create(createElement(Probe)); }); await act(async () => { await vi.advanceTimersByTimeAsync(10); }); }; // the first load starts one tick after the page opens
  afterEach(() => { act(() => r?.unmount()); closed = false; });
  const tick = (ms = 10) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it("starts awaiting departure with the one button that fits; nothing is assumed from the clock", async () => {
    await mount();
    expect(api.journey.state).toBe("awaiting-departure");
    expect(api.actions).toEqual(["departed"]);
    expect(api.rows).toEqual([]);
  });
  it("online: leaving is sent at once with the time of the tap; the history reloads from the server", async () => {
    await mount();
    let out = "";
    const tapped = Date.now();
    await act(async () => { out = await api.record("departed", { source: "gps", accuracyM: 9, from: "Hyderabad" }); });
    await tick();
    expect(out).toBe("saved");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ kind: "departed", at: new Date(tapped).toISOString(), source: "gps", accuracy_m: 9, meta: { from: "Hyderabad" } });
    expect(api.journey.state).toBe("travelling");
    expect(api.rows.map((x) => x.label)).toEqual(["Departed from Hyderabad"]);
    expect(api.pendingCount).toBe(0);
  });
  it("OFFLINE: leaving works, the state and buttons are right at once, the event keeps its real time, and it is sent once when back online", async () => {
    online = false;
    await mount();
    let out = "";
    const tapped = Date.now();
    await act(async () => { out = await api.record("departed", { source: "manual" }); });
    expect(out).toBe("queued");
    expect(api.journey.state).toBe("travelling");        // already, with no signal
    expect(api.actions).toEqual(["paused", "rest_started"]);
    expect(api.pendingCount).toBe(1);
    expect(api.rows[0]).toMatchObject({ label: "Departed", certainty: "pending" }); // shown as waiting, never as recorded
    vi.setSystemTime(T0 + 8 * 3_600_000);                // hours later, the connection returns
    online = true;
    await act(async () => { winListeners.online?.forEach((f) => f()); await vi.advanceTimersByTimeAsync(50); });
    await tick(100);
    expect(posts).toHaveLength(1);
    expect(posts[0].body.at).toBe(new Date(tapped).toISOString()); // the tap time (8 hours earlier), not the sync time
    expect(api.pendingCount).toBe(0);
    expect(api.rows).toHaveLength(1);
    expect(api.rows[0].certainty).toBe("manual");
  });
  it("a retry after a lost answer carries the same id (the server keeps one event)", async () => {
    online = false;
    await mount();
    await act(async () => { await api.record("departed", { source: "manual" }); });
    const saved = JSON.parse(store[outboxKey("me", TRIP)]).items[0] as { eventId: string };
    expect(saved.eventId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    online = true; postReply = { status: 503 }; // the server is down: kept for later, same id
    await act(async () => { winListeners.online?.forEach((f) => f()); await vi.advanceTimersByTimeAsync(50); });
    expect(JSON.parse(store[outboxKey("me", TRIP)]).items).toHaveLength(1);
    postReply = { status: 200, body: { ok: true, duplicate: true } };
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
    expect(new Set(posts.map((p) => p.body.client_event_id))).toEqual(new Set([saved.eventId]));
  });
  it("a refused event (409) leaves the history untouched and says why", async () => {
    await mount();
    postReply = { status: 409, body: { error: "The journey is on the road, so \"departed\" doesn't fit here.", code: "invalid-transition" } };
    await act(async () => { await api.record("departed", { source: "manual" }); });
    await tick();
    expect(api.pendingCount).toBe(0);                    // refused for good: not kept to be retried forever
    expect(serverEvents).toEqual([]);
  });
  it("another device's events appear (the journey follows the traveller), and the buttons follow", async () => {
    serverEvents = [{ clientEventId: "evt-phone-two", kind: "departed", occurredAt: new Date(T0 - 3_600_000).toISOString(), source: "gps", userId: "me", meta: {} }, { clientEventId: "evt-phone-tw2", kind: "rest_started", occurredAt: new Date(T0 - 1_800_000).toISOString(), source: "manual", userId: "me", meta: {} }];
    await mount();
    expect(api.journey.state).toBe("resting");
    expect(api.actions).toEqual(["rest_ended"]);
  });
  it("offline with a copy on this phone: shows the last known journey; a server problem never wipes it", async () => {
    store[journeyCacheKey("me", TRIP)] = JSON.stringify({ events: [{ clientEventId: "evt-cached-01", kind: "departed", occurredAt: new Date(T0 - 1000).toISOString(), source: "manual", userId: "me", meta: {} }] });
    online = false;
    await mount();
    expect(api.journey.state).toBe("travelling");
    getStatus = 500; online = true;
    await act(async () => { await api.reload(); });
    expect(api.journey.state).toBe("travelling");
  });
  it("damaged saved data never breaks the page", async () => {
    store[journeyCacheKey("me", TRIP)] = "{not json";
    online = false;
    await mount();
    expect(api.journey.state).toBe("awaiting-departure");
    store[journeyCacheKey("me", TRIP)] = JSON.stringify({ events: [{ kind: "departed" }, null, 5, { clientEventId: "evt-x-000001", kind: "teleported", occurredAt: "2026-01-01T00:00:00Z", source: "manual" }] });
    await act(async () => { r.update(createElement(Probe)); });
    expect(api.journey.state).toBe("awaiting-departure");
  });
  it("a finished trip offers no buttons", async () => {
    closed = true;
    await mount();
    expect(api.actions).toEqual([]);
  });
  it("where the server has no history tables yet, it says so and keeps working from this phone", async () => {
    stored = false;
    await mount();
    expect(api.stored).toBe(false);
  });
  it("the journey carries on across midnight with no end of day: leave 10 PM, still travelling at 2 AM", async () => {
    vi.setSystemTime(Date.parse("2026-11-02T16:30:00Z")); // 10:00 PM IST
    await mount();
    await act(async () => { await api.record("departed", { source: "manual" }); });
    await tick();
    vi.setSystemTime(Date.parse("2026-11-02T20:30:00Z")); // 2:00 AM IST, next date
    await act(async () => { r.update(createElement(Probe)); await vi.advanceTimersByTimeAsync(10); });
    expect(api.journey.state).toBe("travelling");
    expect(api.rows.map((x) => x.label)).toContain("Journey continued into Tue 3 Nov");
    expect(api.rows.find((x) => x.label.startsWith("Journey continued"))!.certainty).toBe("inferred");
  });
});

describe("the journey card", () => {
  const base = (events: JourneyEvent[], o: Partial<Parameters<typeof JourneyCard>[0]> = {}) => {
    const journey = deriveJourney(events);
    return { journey, actions: allowedActions(journey.state), rows: buildTimeline(events, { offsetMin: 330, me: "u1" }), record: async () => "saved" as const, fix: { source: "manual" as const }, waiting: 0, stored: true as boolean | null, closed: false, offsetMin: 330, ...o };
  };
  const html = (events: JourneyEvent[], o: Partial<Parameters<typeof JourneyCard>[0]> = {}) => renderToStaticMarkup(createElement(JourneyCard, base(events, o)));
  const ev = (kind: JourneyEvent["kind"], at: string, o: Partial<JourneyEvent> = {}): JourneyEvent => ({ clientEventId: `evt-${kind}-${at}`.slice(0, 40), kind, occurredAt: at, source: "manual", userId: "u1", ...o });

  it("before leaving: says so, offers only 'I've left', and tells the privacy rule", () => {
    const h = html([]);
    expect(h).toContain("You haven&#x27;t set off yet."); expect(h).toContain("I&#x27;ve left"); expect(h).not.toContain("Pause");
    expect(h).toContain("never a trail of where you went");
  });
  it("on the road: since when (India time), and Pause / Stop to rest", () => {
    const h = html([ev("departed", "2026-11-02T16:30:00Z")]);
    expect(h).toContain("On the road since 10:00 PM, Mon 2 Nov."); expect(h).toContain("Pause"); expect(h).toContain("Stop to rest"); expect(h).not.toContain("I&#x27;ve left");
  });
  it("paused and resting: the way back onto the road", () => {
    expect(html([ev("departed", "2026-11-02T16:30:00Z"), ev("paused", "2026-11-02T17:30:00Z")])).toContain("Back on the road");
    const h = html([ev("departed", "2026-11-02T16:30:00Z"), ev("rest_started", "2026-11-02T20:45:00Z")]);
    expect(h).toContain("Resting since 2:15 AM, Tue 3 Nov."); expect(h).toContain("Back on the road");
  });
  it("arrived but not visited: says it is not marked visited", () => {
    const h = html([ev("departed", "2026-11-02T16:30:00Z"), ev("arrived", "2026-11-02T20:30:00Z", { placeId: "v", placeName: "Vijayawada" })]);
    expect(h).toContain("Arrived at Vijayawada 2:00 AM; not marked visited yet.");
  });
  it("a finished trip: no buttons", () => {
    const h = html([ev("departed", "2026-11-02T16:30:00Z")], { actions: [], closed: true });
    expect(h).toContain("This trip is finished or called off."); expect(h).not.toContain("Pause");
  });
  it("waiting updates and a database without history are said plainly", () => {
    expect(html([], { waiting: 1 })).toContain("1 update is saved on this phone and will be sent when you&#x27;re back online.");
    expect(html([], { waiting: 3 })).toContain("3 updates are saved on this phone");
    expect(html([], { stored: false })).toContain("can&#x27;t be saved to the trip yet");
  });
  it("the timeline says how sure each line is, and the worked-out midnight is marked as not recorded", () => {
    const h = html([ev("departed", "2026-11-02T16:30:00Z", { source: "gps" }), ev("arrived", "2026-11-02T20:30:00Z", { placeName: "Vijayawada" })], { rows: buildTimeline([ev("departed", "2026-11-02T16:30:00Z", { source: "gps" }), ev("arrived", "2026-11-02T20:30:00Z", { placeName: "Vijayawada" })], { offsetMin: 330, me: "u1", nowMs: Date.parse("2026-11-02T21:00:00Z") }) });
    expect(h).toContain("Journey so far (3)"); expect(h).toContain("From your phone&#x27;s location"); expect(h).toContain("You said"); expect(h).toContain("Worked out, not recorded");
    expect(h).toContain("Journey continued into Tue 3 Nov"); expect(h).toContain("nothing was recorded");
  });
  it("an event that did not fit is counted, not hidden", () => {
    const h = html([ev("departed", "2026-11-02T16:30:00Z"), { ...ev("departed", "2026-11-02T17:30:00Z"), clientEventId: "evt-second-dep" }]);
    expect(h).toContain("One update didn&#x27;t fit the order of events");
  });
  it("touch targets are at least 44 px and long names wrap instead of widening the screen", () => {
    const h = html([ev("departed", "2026-11-02T16:30:00Z")]);
    expect(h).toContain("min-h-11"); expect(h).toContain("break-words");
  });
});

describe("'I visited somewhere else' (an unplanned stop)", () => {
  const base = { journey: deriveJourney([]), actions: allowedActions("awaiting-departure"), rows: [], fix: { source: "manual" as const }, waiting: 0, stored: true as boolean | null, closed: false, offsetMin: 330 };
  const flat = (n: TestRenderer.ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(flat).join(""));
  const text = (r: TestRenderer.ReactTestRenderer) => flat(r.root);
  const press = async (r: TestRenderer.ReactTestRenderer, label: string) => {
    const textOf = (n: TestRenderer.ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(""));
    const b = r.root.findAll((n) => n.type === "button" && textOf(n).includes(label))[0];
    await act(async () => { b.props.onClick(); });
  };
  const type = async (r: TestRenderer.ReactTestRenderer, v: string) => { await act(async () => { r.root.findByType("input").props.onChange({ target: { value: v } }); }); };
  const submit = async (r: TestRenderer.ReactTestRenderer) => { await act(async () => { r.root.findByType("form").props.onSubmit({ preventDefault() {} }); }); };

  it("is offered on the card; the plan is not touched until the traveller says so", async () => {
    const calls: string[] = [];
    const unplanned = { add: async (n: string) => { calls.push(`add:${n}`); }, addToPlan: async (n: string) => { calls.push(`plan:${n}`); }, dayLabel: "Day 2" };
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(JourneyCard, { ...base, record: async () => "saved" as const, unplanned })); });
    expect(text(r)).toContain("I visited somewhere else");
    await press(r, "I visited somewhere else");
    await submit(r);                         // no name: nothing happens
    expect(calls).toEqual([]);
    await type(r, "  Roadside Hanuman temple  ");
    await submit(r);
    expect(calls).toEqual(["add:Roadside Hanuman temple"]); // trimmed, noted in the journey only
    expect(text(r)).toContain("Noted: Roadside Hanuman temple."); expect(text(r)).toContain("Add to Day 2"); expect(text(r)).toContain("Nothing is marked done");
    await press(r, "Add to Day 2");
    expect(calls).toEqual(["add:Roadside Hanuman temple", "plan:Roadside Hanuman temple"]);
    expect(text(r)).toContain("is in your plan as your next stop");
    act(() => r.unmount());
  });
  it("'No, just note it' leaves the plan alone", async () => {
    const calls: string[] = [];
    const unplanned = { add: async (n: string) => { calls.push(`add:${n}`); }, addToPlan: async () => { calls.push("plan"); }, dayLabel: "Day 1" };
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(JourneyCard, { ...base, record: async () => "saved" as const, unplanned })); });
    await press(r, "I visited somewhere else"); await type(r, "Lake view"); await submit(r); await press(r, "No, just note it");
    expect(calls).toEqual(["add:Lake view"]);
    expect(text(r)).toContain("I visited somewhere else");
    act(() => r.unmount());
  });
  it("without a precise position there is no 'add to plan': the stop is only noted (a place is never invented)", async () => {
    const unplanned = { add: async () => {}, addToPlan: null, dayLabel: "Day 1" };
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(JourneyCard, { ...base, record: async () => "saved" as const, unplanned })); });
    await press(r, "I visited somewhere else"); await type(r, "A dhaba"); await submit(r);
    expect(text(r)).toContain("Noted: A dhaba."); expect(text(r)).not.toContain("Add to Day");
    act(() => r.unmount());
  });
  it("Cancel closes the form without saving, and a finished trip does not offer it", async () => {
    const calls: string[] = [];
    const unplanned = { add: async () => { calls.push("add"); }, addToPlan: null, dayLabel: "Day 1" };
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(JourneyCard, { ...base, record: async () => "saved" as const, unplanned })); });
    await press(r, "I visited somewhere else"); await type(r, "x"); await press(r, "Cancel");
    expect(calls).toEqual([]); expect(text(r)).toContain("I visited somewhere else");
    act(() => r.unmount());
    await act(async () => { r = TestRenderer.create(createElement(JourneyCard, { ...base, record: async () => "saved" as const, unplanned, closed: true, actions: [] })); });
    expect(text(r)).not.toContain("I visited somewhere else");
    act(() => r.unmount());
  });
});
