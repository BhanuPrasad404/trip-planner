import { createElement, act, type ReactNode } from "react";
import TestRenderer from "react-test-renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));

// Browser Supabase client used by the dialog (broadcast) and the watcher (existence check + broadcast listener).
const browser = {
  tripRow: { id: "t" } as { id: string } | null,
  tripError: null as unknown,
  throwOnCheck: false,
  checks: 0,
  sent: [] as unknown[],
  listeners: [] as { event: string; cb: () => void }[],
};
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { browser.checks++; if (browser.throwOnCheck) throw new TypeError("fetch failed"); return { data: browser.tripRow, error: browser.tripError }; } }) }) }),
    channel: () => {
      const ch = {
        on: (_t: string, f: { event: string }, cb: () => void) => { browser.listeners.push({ event: f.event, cb }); return ch; },
        subscribe: (cb?: (s: string) => void) => { cb?.("SUBSCRIBED"); return ch; },
        send: async (m: unknown) => { browser.sent.push(m); return "ok"; },
      };
      return ch;
    },
    removeChannel: async () => "ok",
  }),
}));
const serverUser = { current: { id: "owner" } as { id: string } | null };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: serverUser.current } }) } }) }));

import { reportError } from "@/lib/monitoring";
import { deleteTrip } from "@/lib/server/trip-delete";
import { DELETE } from "@/app/api/trips/[id]/route";
import { DeleteTripButton } from "@/components/DeleteTripButton";
import { TripGoneWatcher } from "@/components/TripGoneWatcher";
import {
  TRIP_DELETED_TITLE, TRIP_GONE_EVENT, TRIP_GONE_TITLE, forgetTripLocally, groupByBucket, provesTripGone,
  storageObjectFromUrl, tripNameMatches,
} from "@/lib/trip/deletion";

const TRIP = "11111111-0000-4000-8000-000000000001";
const SB = "https://abcd.supabase.co";
// The watcher tests use another trip: the dialog tests (correctly) mark TRIP as "being deleted on this device".
const OTHER_TRIP = "11111111-0000-4000-8000-000000000002";

describe("pure helpers", () => {
  it("tripNameMatches ignores case and extra spaces, never matches empty", () => {
    expect(tripNameMatches("  araku   WEEKEND ", "Araku weekend")).toBe(true);
    expect(tripNameMatches("Araku", "Araku weekend")).toBe(false);
    expect(tripNameMatches("   ", "   ")).toBe(false);
  });
  it("storageObjectFromUrl accepts only our own Supabase storage URLs", () => {
    expect(storageObjectFromUrl(`${SB}/storage/v1/object/public/trip-media/u1/a%20b.jpg`, SB)).toEqual({ bucket: "trip-media", path: "u1/a b.jpg" });
    expect(storageObjectFromUrl(`${SB}/storage/v1/object/sign/trip-media/u1/x.mp4?token=abc`, SB)).toEqual({ bucket: "trip-media", path: "u1/x.mp4" });
    expect(storageObjectFromUrl("https://evil.example/storage/v1/object/public/b/p.jpg", SB)).toBeNull();
    expect(storageObjectFromUrl(`${SB}/storage/v1/object/public/b/../secret.jpg`, SB)).toBeNull();
    expect(storageObjectFromUrl("x/y.jpg", SB)).toBeNull();
  });
  it("groupByBucket groups and de-duplicates", () => {
    expect(groupByBucket([{ bucket: "a", path: "1" }, { bucket: "a", path: "1" }, { bucket: "b", path: "2" }])).toEqual([{ bucket: "a", paths: ["1"] }, { bucket: "b", paths: ["2"] }]);
  });
  it("provesTripGone: only a clean empty answer proves it; errors never do", () => {
    expect(provesTripGone({ data: null, error: null })).toBe(true);
    expect(provesTripGone({ data: { id: "t" }, error: null })).toBe(false);
    expect(provesTripGone({ data: null, error: { message: "network" } })).toBe(false);
  });
  it("forgetTripLocally removes only this trip's saved keys", () => {
    const data: Record<string, string> = { [`tm:visits:${TRIP}`]: "1", [`tm:vehicle:${TRIP}`]: "1", "tm:visits:other": "1", "tm:map-theme": "dark", [`not-ours:${TRIP}`]: "1" };
    const store = { get length() { return Object.keys(data).length; }, key: (i: number) => Object.keys(data)[i] ?? null, removeItem: (k: string) => { delete data[k]; } };
    expect(forgetTripLocally(TRIP, store)).toBe(2);
    expect(Object.keys(data).sort()).toEqual([`not-ours:${TRIP}`, "tm:map-theme", "tm:visits:other"]);
  });
});

type FakeOpts = { trip?: Record<string, unknown> | null; media?: { file_url: string | null }[]; findError?: unknown; deleteError?: unknown; deleted?: number };
function fakeDb(o: FakeOpts = {}) {
  const calls: string[] = [];
  const client = {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      let deleting = false;
      Object.assign(q, {
        select: chain, eq: chain, limit: chain,
        delete: () => { deleting = true; calls.push(`delete:${table}`); return q; },
        maybeSingle: async () => ({ data: o.trip === undefined ? { id: TRIP, owner_id: "owner", name: "Araku weekend" } : o.trip, error: o.findError ?? null }),
        then: (res: (v: unknown) => unknown) => {
          if (deleting) return res({ data: o.deleteError ? null : Array.from({ length: o.deleted ?? 1 }, () => ({ id: TRIP })), error: o.deleteError ?? null });
          return res({ data: table === "trip_media" ? (o.media ?? []) : [], error: null });
        },
      });
      return q;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}
function fakeAdmin(fail = false) {
  const removed: string[] = [];
  const client = { storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => { if (fail) return { error: { message: "boom" } }; removed.push(...paths.map((p) => `${bucket}:${p}`)); return { error: null }; } }) } } as unknown as SupabaseClient;
  return { client, removed };
}
const run = (db: SupabaseClient, admin: SupabaseClient | null, o: { userId?: string; confirmName?: string } = {}) =>
  deleteTrip({ supabase: db, admin, supabaseUrl: SB, userId: o.userId ?? "owner", tripId: TRIP, confirmName: o.confirmName ?? "Araku weekend" });

describe("deleteTrip (server)", () => {
  beforeEach(() => vi.mocked(reportError).mockClear());

  it("owner + right name: deletes the trip (the database cascades stops, votes, members, live rows)", async () => {
    const { client, calls } = fakeDb();
    expect(await run(client, null)).toEqual({ ok: true, filesRemoved: 0 });
    expect(calls).toEqual(["delete:trips"]);
  });
  it("a member is refused with a clear message and nothing is deleted", async () => {
    const { client, calls } = fakeDb();
    expect(await run(client, null, { userId: "member" })).toEqual({ ok: false, status: 403, error: "Only the trip owner can delete this trip." });
    expect(calls).toEqual([]);
  });
  it("unknown trip → 404; wrong name → 400; neither deletes", async () => {
    const a = fakeDb({ trip: null });
    expect((await run(a.client, null)).ok).toBe(false);
    const b = fakeDb();
    expect(await run(b.client, null, { confirmName: "Araku" })).toMatchObject({ ok: false, status: 400 });
    expect([...a.calls, ...b.calls]).toEqual([]);
  });
  it("stored photos/videos are removed from Storage FIRST, then the trip", async () => {
    const { client, calls } = fakeDb({ media: [{ file_url: `${SB}/storage/v1/object/public/trip-media/m/1.jpg` }, { file_url: `${SB}/storage/v1/object/public/trip-media/b/2.mp4` }, { file_url: "https://elsewhere.example/x.jpg" }, { file_url: null }] });
    const admin = fakeAdmin();
    expect(await run(client, admin.client)).toEqual({ ok: true, filesRemoved: 2 });
    expect(admin.removed).toEqual(["trip-media:m/1.jpg", "trip-media:b/2.mp4"]);
    expect(calls).toEqual(["delete:trips"]);
  });
  it("files that can't be removed (no service key, or Storage fails) → nothing is deleted, no orphaned private photos", async () => {
    const media = [{ file_url: `${SB}/storage/v1/object/public/trip-media/m/1.jpg` }];
    const a = fakeDb({ media });
    expect(await run(a.client, null)).toMatchObject({ ok: false, status: 503 });
    const b = fakeDb({ media });
    expect(await run(b.client, fakeAdmin(true).client)).toMatchObject({ ok: false, status: 502 });
    expect([...a.calls, ...b.calls]).toEqual([]);
    expect(reportError).toHaveBeenCalledTimes(1);
  });
  it("a database error is reported without leaking its text; a race where the row is already gone is a 404", async () => {
    const a = fakeDb({ deleteError: { code: "XX000", message: "internal detail" } });
    const r = await run(a.client, null);
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(JSON.stringify(r)).not.toContain("internal detail");
    expect(await run(fakeDb({ deleted: 0 }).client, null)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("DELETE /api/trips/[id]", () => {
  const call = (id: string, body: unknown) => DELETE(new Request(`https://trailmate.app/api/trips/${id}`, { method: "DELETE", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  beforeEach(() => { serverUser.current = { id: "owner" }; process.env.NEXT_PUBLIC_SUPABASE_URL = SB; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon"; });
  it("bad id → 400, signed out → 401, missing confirmation → 400", async () => {
    expect((await call("not-a-uuid", { confirm_name: "x" })).status).toBe(400);
    serverUser.current = null;
    expect((await call(TRIP, { confirm_name: "x" })).status).toBe(401);
    serverUser.current = { id: "owner" };
    expect((await call(TRIP, {})).status).toBe(400);
  });
});

describe("DeleteTripButton", () => {
  let r: TestRenderer.ReactTestRenderer;
  let fetchCalls: { url: string; init: RequestInit }[];
  let answer: { status: number; body: unknown };
  beforeEach(() => {
    fetchCalls = []; answer = { status: 200, body: { ok: true } }; router.replace.mockClear(); browser.sent = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { fetchCalls.push({ url, init }); return { ok: answer.status < 300, status: answer.status, json: async () => answer.body }; });
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {}, localStorage: { length: 0, key: () => null, removeItem() {} } });
  });
  afterEach(() => { act(() => r?.unmount()); vi.unstubAllGlobals(); });
  const mount = () => act(() => { r = TestRenderer.create(createElement(DeleteTripButton, { tripId: TRIP, tripName: "Araku weekend" })); });
  const buttons = () => r.root.findAllByType("button");
  const byText = (t: string) => buttons().find((b) => JSON.stringify(b.props.children).includes(t))!;
  const type = (v: string) => act(() => { r.root.findByType("input").props.onChange({ target: { value: v } }); });

  it("explains what is lost, and Delete stays disabled until the trip name is typed", async () => {
    mount();
    await act(async () => { byText("Delete trip").props.onClick(); });
    const text = JSON.stringify(r.toJSON());
    expect(text).toContain("everyone");
    expect(text).toContain("Finish trip");
    expect(byText("Delete forever").props.disabled).toBe(true);
    type("araku");
    expect(byText("Delete forever").props.disabled).toBe(true);
    type("araku weekend");
    expect(byText("Delete forever").props.disabled).toBe(false);
  });

  it("deletes, tells members (broadcast), and goes to My trips", async () => {
    mount();
    await act(async () => { byText("Delete trip").props.onClick(); });
    type("Araku weekend");
    await act(async () => { await byText("Delete forever").props.onClick(); });
    expect(fetchCalls[0].url).toBe(`/api/trips/${TRIP}`);
    expect(fetchCalls[0].init.method).toBe("DELETE");
    expect(JSON.parse(fetchCalls[0].init.body as string)).toEqual({ confirm_name: "Araku weekend" });
    expect(browser.sent).toHaveLength(1);
    expect(router.replace).toHaveBeenCalledWith("/trips?deleted=1");
  });

  it("a refusal from the server is shown, and nothing navigates away", async () => {
    answer = { status: 403, body: { error: "Only the trip owner can delete this trip." } };
    mount();
    await act(async () => { byText("Delete trip").props.onClick(); });
    type("Araku weekend");
    await act(async () => { await byText("Delete forever").props.onClick(); });
    expect(JSON.stringify(r.toJSON())).toContain("Only the trip owner");
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("TripGoneWatcher (another member has the trip open, maybe driving)", () => {
  let r: TestRenderer.ReactTestRenderer;
  let docListeners: Record<string, (() => void)[]>;
  let events: string[];
  let online: boolean;
  beforeEach(() => {
    vi.useFakeTimers();
    browser.tripRow = { id: OTHER_TRIP }; browser.tripError = null; browser.throwOnCheck = false; browser.checks = 0; browser.listeners = [];
    docListeners = {}; events = []; online = true;
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: (n: string, f: () => void) => { (docListeners[n] ??= []).push(f); }, removeEventListener() {} });
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {}, dispatchEvent: (e: Event) => { events.push(e.type); return true; }, localStorage: { length: 0, key: () => null, removeItem() {} } });
    vi.stubGlobal("navigator", { get onLine() { return online; } });
    vi.stubGlobal("CustomEvent", class { type: string; detail: unknown; constructor(t: string, i?: { detail?: unknown }) { this.type = t; this.detail = i?.detail; } });
  });
  afterEach(() => { act(() => r?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const mount = () => act(() => { r = TestRenderer.create(createElement(TripGoneWatcher, { tripId: OTHER_TRIP })); });
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const shown = () => JSON.stringify(r.toJSON());

  it("owner's broadcast + the trip really gone → 'deleted by the owner', and Drive mode is told to stop", async () => {
    mount();
    expect(r.toJSON()).toBeNull();
    browser.tripRow = null;
    act(() => browser.listeners.filter((l) => l.event === "trip-deleted").forEach((l) => l.cb()));
    await flush();
    expect(shown()).toContain(TRIP_DELETED_TITLE);
    expect(shown()).toContain("navigation and location sharing have stopped");
    expect(events).toEqual([TRIP_GONE_EVENT]);
  });

  it("a fake broadcast while the trip still exists changes nothing", async () => {
    mount();
    act(() => browser.listeners.filter((l) => l.event === "trip-deleted").forEach((l) => l.cb()));
    await flush();
    expect(r.toJSON()).toBeNull();
    expect(events).toEqual([]);
  });

  it("no broadcast (e.g. realtime blocked): the regular check finds it and says so honestly", async () => {
    mount();
    browser.tripRow = null;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await flush();
    expect(shown()).toContain(TRIP_GONE_TITLE);
  });

  it("offline or a server error is never mistaken for a deletion", async () => {
    mount();
    browser.tripRow = null; browser.throwOnCheck = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    browser.throwOnCheck = false; browser.tripError = { message: "503" };
    await act(async () => { docListeners.visibilitychange?.forEach((f) => f()); });
    online = false; browser.tripError = null;
    const before = browser.checks;
    await act(async () => { docListeners.visibilitychange?.forEach((f) => f()); });
    await flush();
    expect(browser.checks).toBe(before); // offline: not even asked
    expect(r.toJSON()).toBeNull();
    expect(events).toEqual([]);
  });
});
