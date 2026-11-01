// Task 6: the outbox — changes made with no signal are kept on this phone FOR THIS PERSON, shown at once, and sent when online.
import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const announced: string[] = [];
vi.mock("@/lib/client/stop-signal", () => ({ announceStopsChanged: async (t: string) => { announced.push(t); }, announceTripStatus: async () => undefined }));
vi.mock("@/lib/client/image", () => ({ fileToDataUrl: async () => "data:image/jpeg;base64,AAAA" }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }) }));

import {
  OUTBOX_MAX_AGE_MS, OUTBOX_MAX_ITEMS, addToOutbox, applyOutboxToPlaces, applyOutboxToVotes, classify, countWaiting, foreignKeys,
  itemKey, outboxKey, parseOutbox, requestFor, type OutboxItem,
} from "@/lib/client/outbox";
import { useOutbox } from "@/lib/client/use-outbox";
import { OutboxStatus } from "@/components/OutboxStatus";
import { PlaceReports } from "@/components/PlaceReports";
import { SignOutForm, signOutWarning } from "@/components/SignOutForm";

const T0 = 1_800_000_000_000;
const st = (placeId: string, status: "done" | "skipped" | "planned", at = T0): OutboxItem => ({ kind: "status", placeId, status, at });

describe("outbox (pure)", () => {
  it("the newest change per stop and kind wins; different kinds for one stop are kept side by side", () => {
    let items: OutboxItem[] = [];
    items = addToOutbox(items, st("p1", "done", T0)).items;
    items = addToOutbox(items, { kind: "vote", placeId: "p1", vote: 1, at: T0 + 1 }).items;
    items = addToOutbox(items, st("p1", "planned", T0 + 2)).items;
    expect(items.map(itemKey)).toEqual(["vote:p1", "status:p1"]);
    expect(items.find((i) => i.kind === "status")).toMatchObject({ status: "planned" });
  });
  it("beyond 50 waiting changes the OLDEST are dropped, and returned so the person can be told", () => {
    let items: OutboxItem[] = [];
    for (let i = 0; i < OUTBOX_MAX_ITEMS; i++) items = addToOutbox(items, st(`p${i}`, "done", T0 + i)).items;
    const r = addToOutbox(items, st("new", "done", T0 + 999));
    expect(r.items).toHaveLength(OUTBOX_MAX_ITEMS);
    expect(r.dropped.map(itemKey)).toEqual(["status:p0"]);
    expect(r.items.at(-1)).toMatchObject({ placeId: "new" });
  });
  it("old (over 7 days), damaged, unknown or invalid saved items are dropped; nothing can break the page", () => {
    const raw = JSON.stringify({ items: [
      st("ok", "done", T0 - 1000),
      st("old", "done", T0 - OUTBOX_MAX_AGE_MS - 1),
      { kind: "delete", placeId: "x", at: T0 },                                                     // never queueable
      { kind: "relocate", placeId: "x", lat: 95, lng: 78, address: null, at: T0 },                    // impossible latitude
      { kind: "report", clientId: "r", placeName: "Fort", lat: 17, lng: 78, tags: [], note: null, at: T0 }, // empty update
      { kind: "report", clientId: "r2", placeName: "Fort", lat: 17, lng: 78, tags: ["a", "b", "c", "d", "e", "f", "g"], note: null, at: T0 },
      { kind: "vote", placeId: "x", vote: 5, at: T0 },
      null, "junk",
    ] });
    expect(parseOutbox(raw, T0).map(itemKey)).toEqual(["status:ok"]);
    expect(parseOutbox("{not json", T0)).toEqual([]);
    expect(parseOutbox(JSON.stringify({ items: "x" }), T0)).toEqual([]);
  });
  it("each kind becomes the right request (a queued update never carries a photo)", () => {
    expect(requestFor(st("p1", "done"))).toMatchObject({ url: "/api/places/p1", init: { method: "PATCH", body: JSON.stringify({ status: "done", at: new Date(T0).toISOString() }) } });
    // the time sent is when the person ACTED (this item's `at`), and the ids travel with it
    expect(JSON.parse(requestFor({ kind: "status", placeId: "p1", status: "done", expected: "planned", eventId: "evt-12345678", at: T0 }).init.body as string)).toEqual({ status: "done", at: new Date(T0).toISOString(), expected: "planned", event_id: "evt-12345678" });
    expect(JSON.parse(requestFor({ kind: "arrive", placeId: "p1", arrived: true, eventId: "evt-87654321", at: T0 }).init.body as string)).toEqual({ arrived: true, at: new Date(T0).toISOString(), event_id: "evt-87654321" });
    expect(requestFor({ kind: "vote", placeId: "p1", vote: -1, at: T0 })).toMatchObject({ url: "/api/places/p1/vote", init: { method: "POST", body: JSON.stringify({ vote: -1 }) } });
    expect(requestFor({ kind: "move", placeId: "p1", day: null, at: T0 })).toMatchObject({ init: { body: JSON.stringify({ day_number: null }) } });
    expect(requestFor({ kind: "relocate", placeId: "p1", lat: 17.4, lng: 78.5, address: "Abids", at: T0 })).toMatchObject({ init: { body: JSON.stringify({ lat: 17.4, lng: 78.5, address: "Abids" }) } });
    const rep = requestFor({ kind: "report", clientId: "c", placeName: "Fort", lat: 17, lng: 78, tags: ["crowded"], note: "Busy", at: T0 });
    expect(rep.url).toBe("/api/reports");
    expect(JSON.parse(rep.init.body as string)).toEqual({ place_name: "Fort", lat: 17, lng: 78, tags: ["crowded"], note: "Busy", photo_path: null });
  });
  it("network/server trouble, sign-in refresh and daily limits are retried; a real refusal is final", () => {
    expect(classify(200)).toBe("ok"); expect(classify(201)).toBe("ok");
    for (const s of [null, 401, 408, 429, 500, 503]) expect(classify(s)).toBe("retry");
    for (const s of [400, 403, 404, 409]) expect(classify(s)).toBe("failed");
  });
  it("waiting changes are shown on top of the stops and the votes", () => {
    const places = [
      { id: "a", status: "planned", day_number: 1, sequence_order: 1, lat: 17, lng: 78, address: null },
      { id: "b", status: "planned", day_number: 1, sequence_order: 2, lat: 17.1, lng: 78.1, address: null },
      { id: "c", status: "planned", day_number: 2, sequence_order: 1, lat: 17.2, lng: 78.2, address: null },
    ];
    const items: OutboxItem[] = [st("a", "done"), { kind: "move", placeId: "c", day: 1, at: T0 }, { kind: "relocate", placeId: "b", lat: 18, lng: 79, address: "New", at: T0 }];
    const out = applyOutboxToPlaces(places, items);
    expect(out.find((p) => p.id === "a")?.status).toBe("done");
    expect(out.find((p) => p.id === "c")).toMatchObject({ day_number: 1, sequence_order: 3 }); // to the end of that day
    expect(out.find((p) => p.id === "b")).toMatchObject({ lat: 18, lng: 79, address: "New" });
    const votes = applyOutboxToVotes({ a: { up: 2, down: 0, score: 2, mine: 1 } }, [{ kind: "vote", placeId: "a", vote: -1, at: T0 }, { kind: "vote", placeId: "b", vote: 1, at: T0 }]);
    expect(votes).toEqual({ a: { up: 1, down: 1, score: 0, mine: -1 }, b: { up: 1, down: 0, score: 1, mine: 1 } });
  });
  it("on a shared phone, other people's outboxes and the old unowned queue are the ones to delete", () => {
    const keys = [outboxKey("me", "t1"), outboxKey("me", "t2"), outboxKey("someone", "t1"), "tm:visits:t1", "tm:map-theme", "tm:vehicle:t1"];
    expect(foreignKeys(keys, "me")).toEqual([outboxKey("someone", "t1"), "tm:visits:t1"]);
  });
  it("countWaiting counts only my changes, across my trips", () => {
    const data: Record<string, string> = { [outboxKey("me", "t1")]: JSON.stringify({ items: [st("a", "done"), st("b", "done")] }), [outboxKey("me", "t2")]: JSON.stringify({ items: [st("c", "done")] }), [outboxKey("other", "t1")]: JSON.stringify({ items: [st("x", "done")] }) };
    const s = { get length() { return Object.keys(data).length; }, key: (i: number) => Object.keys(data)[i] ?? null, getItem: (k: string) => data[k] ?? null };
    expect(countWaiting(s, "me", T0)).toBe(3);
  });
});

// ── The hook against a fake phone (storage, connection, server) ──
let store: Record<string, string>; let online: boolean; let replies: { status: number; body?: unknown }[]; let sent: { url: string; body: unknown }[]; let winListeners: Record<string, (() => void)[]>;
const fakeStorage = () => ({ getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; }, get length() { return Object.keys(store).length; }, key: (i: number) => Object.keys(store)[i] ?? null });
beforeEach(() => {
  store = {}; online = true; replies = []; sent = []; winListeners = {}; announced.length = 0;
  vi.useFakeTimers(); vi.setSystemTime(T0);
  vi.stubGlobal("window", {
    localStorage: fakeStorage(), confirm: vi.fn(() => true),
    addEventListener: (n: string, f: () => void) => { (winListeners[n] ??= []).push(f); }, removeEventListener: (n: string, f: () => void) => { winListeners[n] = (winListeners[n] ?? []).filter((x) => x !== f); },
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (i: number) => clearTimeout(i), setInterval: (f: () => void, ms: number) => setInterval(f, ms), clearInterval: (i: number) => clearInterval(i),
  });
  vi.stubGlobal("navigator", { get onLine() { return online; } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    const r = replies.shift() ?? { status: 200, body: { ok: true } };
    if (r.status === -1) throw new TypeError("Failed to fetch");
    const res = { ok: r.status < 300, status: r.status, json: async () => r.body ?? {}, clone: () => res };
    return res;
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("useOutbox", () => {
  let api!: ReturnType<typeof useOutbox>; let synced = 0; let r: TestRenderer.ReactTestRenderer;
  const Probe = ({ user }: { user: string }) => { api = useOutbox("trip1", user, () => { synced++; }, () => T0); return null; };
  const mount = async (user = "me") => { synced = 0; await act(async () => { r = TestRenderer.create(createElement(Probe, { user })); }); };
  afterEach(() => { act(() => r?.unmount()); });
  const goOnline = async () => { online = true; await act(async () => { winListeners.online?.forEach((f) => f()); await vi.advanceTimersByTimeAsync(10); }); };

  it("SHARED PHONE: another person's waiting changes are deleted, never shown and never sent", async () => {
    store[outboxKey("ravi", "trip1")] = JSON.stringify({ items: [st("p1", "done", T0 - 1000)] });
    store["tm:visits:trip1"] = JSON.stringify({ items: [{ placeId: "p2", status: "done", at: T0 - 1000 }] });
    await mount("sita");
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(api.items).toEqual([]);
    expect(sent).toEqual([]);
    expect(Object.keys(store).filter((k) => k.startsWith("tm:"))).toEqual([]);
  });

  it("a vote offline: kept and shown at once, sent when the connection returns, the trip's other screens told", async () => {
    online = false;
    await mount();
    let res = "";
    await act(async () => { res = await api.send({ kind: "vote", placeId: "p1", vote: 1 }, "Golconda Fort"); });
    expect(res).toBe("queued");
    expect(api.items.map(itemKey)).toEqual(["vote:p1"]);
    expect(sent).toEqual([]);
    await goOnline();
    expect(sent).toEqual([{ url: "/api/places/p1/vote", body: { vote: 1 } }]);
    expect(api.items).toEqual([]);
    expect(api.notice).toMatch(/sent/);
    expect(announced).toEqual(["trip1"]);
    expect(synced).toBe(1);
  });

  it("two screens holding the same person's outbox for a trip (the drive and the plan) send each waiting change ONCE", async () => {
    online = false;
    let other!: ReturnType<typeof useOutbox>;
    const Two = () => { api = useOutbox("trip1", "me", () => {}, () => T0); other = useOutbox("trip1", "me", () => {}, () => T0); return null; };
    await act(async () => { r = TestRenderer.create(createElement(Two)); });
    await act(async () => { await api.send({ kind: "vote", placeId: "p1", vote: 1 }, "Golconda Fort"); });
    await act(async () => { await Promise.resolve(); });
    expect(other.items.map(itemKey)).toEqual(["vote:p1"]); // both screens see it
    await goOnline();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(sent).toEqual([{ url: "/api/places/p1/vote", body: { vote: 1 } }]);
  });

  it("a community update offline (text + tags): sent later, without a photo", async () => {
    online = false;
    await mount();
    await act(async () => { await api.send({ kind: "report", clientId: "c1", placeName: "Ramappa Temple", lat: 18.26, lng: 79.94, tags: ["crowded"], note: "Long queue" }); });
    await goOnline();
    expect(sent).toEqual([{ url: "/api/reports", body: { place_name: "Ramappa Temple", lat: 18.26, lng: 79.94, tags: ["crowded"], note: "Long queue", photo_path: null } }]);
  });

  it("the network drops mid-send: kept, not lost; a sign-in refresh (401) is retried too", async () => {
    await mount();
    replies = [{ status: -1 }];
    await act(async () => { await api.send({ kind: "move", placeId: "p1", day: 2 }); });
    await act(async () => { await Promise.resolve(); }); // the screen catches up with the phone's storage
    expect(api.items.map(itemKey)).toEqual(["move:p1"]);
    replies = [{ status: 401 }];
    await act(async () => { await vi.advanceTimersByTimeAsync(10); }); // the immediate retry: sign-in needs refreshing
    expect(api.items.map(itemKey)).toEqual(["move:p1"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(api.items).toEqual([]);
  });

  it("a refusal (stop removed, no longer on the trip) is dropped and the server's reason is shown, naming the stop", async () => {
    online = false;
    await mount();
    await act(async () => { await api.send(st("p1", "done"), "Bhongir Fort"); await api.send(st("p2", "done"), "Lake"); });
    replies = [{ status: 404, body: { error: "Place not found" } }];
    await goOnline();
    expect(api.failed).toBe("Bhongir Fort: marked done couldn't be sent: Place not found");
    expect(api.items).toEqual([]); // the second one was sent after the refusal
    expect(sent.map((s) => s.url)).toEqual(["/api/places/p1", "/api/places/p2"]);
  });

  it("sent in the order they were made, and stops at the first network failure", async () => {
    online = false;
    await mount();
    await act(async () => { await api.send(st("p1", "done")); await api.send({ kind: "vote", placeId: "p2", vote: -1 }); await api.send(st("p3", "skipped")); });
    replies = [{ status: 200 }, { status: -1 }, { status: -1 }]; // the connection is still shaky on the immediate second try
    await goOnline();
    expect(sent.map((s) => s.url)).toEqual(["/api/places/p1", "/api/places/p2/vote", "/api/places/p2/vote"]); // p3 never jumps the queue
    expect(api.items.map(itemKey)).toEqual(["vote:p2", "status:p3"]);
  });
});

describe("screens", () => {
  const outboxWith = (items: OutboxItem[], extra: Record<string, unknown> = {}) => ({ items, send: vi.fn(), syncing: false, failed: null, clearFailed: vi.fn(), notice: null, clearNotice: vi.fn(), ...extra }) as unknown as ReturnType<typeof useOutbox>;

  it("the waiting strip says 'saved on your phone' and lists what is waiting", () => {
    const html = renderToStaticMarkup(createElement(OutboxStatus, { outbox: outboxWith([st("a", "done"), { kind: "vote", placeId: "b", vote: 1, at: T0, label: "Golconda Fort" }]) }));
    expect(html).toContain("2 changes are saved on your phone");
    expect(html).toContain("Golconda Fort: your vote");
    expect(renderToStaticMarkup(createElement(OutboxStatus, { outbox: outboxWith([]) }))).toBe("");
  });

  const textOf = (n: TestRenderer.ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(""));
  const mountReports = (send: ReturnType<typeof vi.fn>) => {
    let tr!: TestRenderer.ReactTestRenderer;
    act(() => { tr = TestRenderer.create(createElement(PlaceReports, { place: { id: "p", name: "Bogatha Falls", lat: 18.4, lng: 80.3 }, reports: [], userId: "me", onChanged: vi.fn(), now: new Date(T0), outbox: outboxWith([], { send }) })); });
    const btn = (t: string) => tr.root.findAllByType("button").find((b) => textOf(b).includes(t))!;
    return { tr, btn };
  };

  it("community update offline (no photo): kept on the phone and it says so", async () => {
    online = false;
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    const send = vi.fn(async () => "queued");
    const { tr, btn } = mountReports(send);
    await act(async () => { btn("Share an update").props.onClick(); });
    act(() => { tr.root.findByType("textarea").props.onChange({ target: { value: "Water is low" } }); });
    await act(async () => { await btn("Post update").props.onClick(); });
    expect(send).toHaveBeenCalledWith({ kind: "report", clientId: "uuid-1", placeName: "Bogatha Falls", lat: 18.4, lng: 80.3, tags: [], note: "Water is low" }, "Bogatha Falls");
    expect(textOf(tr.root)).toContain("Saved on your phone");
    act(() => tr.unmount());
  });

  it("community update offline WITH a photo: refused clearly, nothing queued (a photo is never kept on the phone)", async () => {
    online = false;
    const send = vi.fn(async () => "queued");
    const { tr, btn } = mountReports(send);
    await act(async () => { btn("Share an update").props.onClick(); });
    const file = tr.root.findAll((n) => n.type === "input" && n.props.type === "file")[0];
    await act(async () => { await file.props.onChange({ target: { files: [new Blob(["x"], { type: "image/jpeg" })] } }); });
    await act(async () => { await btn("Post update").props.onClick(); });
    expect(send).not.toHaveBeenCalled();
    expect(textOf(tr.root)).toContain("Photos need a connection");
    act(() => tr.unmount());
  });

  it("signing out with waiting changes warns first; cancelling keeps you signed in; going ahead deletes only YOUR waiting changes", () => {
    store[outboxKey("me", "t1")] = JSON.stringify({ items: [st("a", "done"), st("b", "done")] });
    store[outboxKey("other", "t1")] = JSON.stringify({ items: [st("x", "done")] });
    let tr!: TestRenderer.ReactTestRenderer;
    act(() => { tr = TestRenderer.create(createElement(SignOutForm, { action: async () => undefined, userId: "me" }, createElement("button", { type: "submit" }, "Sign out"))); });
    const form = tr.root.findByType("form");
    const confirm = (globalThis as unknown as { window: { confirm: ReturnType<typeof vi.fn> } }).window.confirm;
    confirm.mockReturnValueOnce(false);
    const ev = { preventDefault: vi.fn() };
    form.props.onSubmit(ev);
    expect(confirm).toHaveBeenCalledWith(signOutWarning(2));
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(store[outboxKey("me", "t1")]).toBeDefined();
    const ev2 = { preventDefault: vi.fn() };
    form.props.onSubmit(ev2);
    expect(ev2.preventDefault).not.toHaveBeenCalled();
    expect(store[outboxKey("me", "t1")]).toBeUndefined();
    act(() => tr.unmount());
  });

  it("signing out with nothing waiting asks nothing", () => {
    let tr!: TestRenderer.ReactTestRenderer;
    act(() => { tr = TestRenderer.create(createElement(SignOutForm, { action: async () => undefined, userId: "me" }, "x")); });
    const confirm = (globalThis as unknown as { window: { confirm: ReturnType<typeof vi.fn> } }).window.confirm;
    tr.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() });
    expect(confirm).not.toHaveBeenCalled();
    act(() => tr.unmount());
  });
});

describe("useLocalJson: a value deleted from storage stays deleted", () => {
  it("does not come back from the in-memory copy (sign-out, deleted trip, another person's outbox)", async () => {
    const { useLocalJson } = await import("@/lib/client/use-local-json");
    const FALLBACK = { items: [] as string[] };
    let val!: { items: string[] }; let set!: (v: { items: string[] }) => void;
    const P = () => { [val, set] = useLocalJson("tm:test-key", FALLBACK); return null; };
    let tr!: TestRenderer.ReactTestRenderer;
    await act(async () => { tr = TestRenderer.create(createElement(P)); });
    await act(async () => { set({ items: ["secret"] }); });
    expect(val.items).toEqual(["secret"]);
    delete store["tm:test-key"]; // removed directly from storage, as sign-out does
    await act(async () => { tr.update(createElement(P)); });
    act(() => tr.unmount());
    await act(async () => { tr = TestRenderer.create(createElement(P)); });
    expect(val.items).toEqual([]);
    act(() => tr.unmount());
  });
});
