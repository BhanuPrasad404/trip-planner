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
