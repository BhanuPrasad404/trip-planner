// Task 3: leave a trip, remove a member, hand a trip over — and a clear screen for the person who was removed.
import { createElement, act, type ReactNode } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));

const browser = { tripRow: { id: "t" } as { id: string } | null, tripError: null as unknown, listeners: [] as { event: string; cb: () => void }[], sent: [] as string[] };
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: browser.tripRow, error: browser.tripError }) }) }) }),
    getChannels: () => [],
    channel: () => {
      const ch = {
        on: (_t: string, f: { event: string }, cb: () => void) => { browser.listeners.push({ event: f.event, cb }); return ch; },
        subscribe: () => ch,
        httpSend: async (event: string) => { browser.sent.push(event); return { success: true }; },
      };
      return ch;
    },
    removeChannel: async () => "ok",
  }),
}));
const serverUser = { current: { id: "owner" } as { id: string } | null };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: serverUser.current } }) } }) }));

import { OWNER_MUST_HAND_OVER, removeMember, transferOwnership } from "@/lib/server/trip-members";
import { DELETE as memberDELETE } from "@/app/api/trips/[id]/members/[userId]/route";
import { POST as ownerPOST } from "@/app/api/trips/[id]/owner/route";
import { MembersPanel } from "@/components/MembersPanel";
import { TripGoneWatcher } from "@/components/TripGoneWatcher";
import { MEMBERS_CHANGED_BROADCAST, TRIP_REMOVED_TITLE } from "@/lib/trip/deletion";
import type { TripMember } from "@/lib/types";

const TRIP = "11111111-0000-4000-8000-0000000000c1";
const SB = "https://abcd.supabase.co";

function fakeDb(o: { trip?: Record<string, unknown> | null; media?: { file_url: string }[]; deleted?: number; rpcError?: { code: string; message: string } | null } = {}) {
  const calls: string[] = [];
  const client = {
    rpc: async (name: string, args: unknown) => { calls.push(`rpc:${name}:${JSON.stringify(args)}`); return { error: o.rpcError ?? null }; },
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      let deleting = false;
      const chain = () => q;
      Object.assign(q, {
        select: chain, eq: chain, limit: chain,
        delete: () => { deleting = true; calls.push(`delete:${table}`); return q; },
        maybeSingle: async () => ({ data: o.trip === undefined ? { id: TRIP, owner_id: "owner", name: "Araku weekend" } : o.trip, error: null }),
        then: (res: (v: unknown) => unknown) => res(deleting ? { data: Array.from({ length: o.deleted ?? 1 }, () => ({ user_id: "x" })), error: null } : { data: table === "trip_media" ? (o.media ?? []) : [], error: null }),
      });
      return q;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}
const run = (db: SupabaseClient, actorId: string, userId: string, admin: SupabaseClient | null = null) => removeMember({ supabase: db, admin, supabaseUrl: SB, actorId, tripId: TRIP, userId });

describe("removeMember (server)", () => {
  it("the owner cannot just leave: told to hand over or delete, nothing changes", async () => {
    const { client, calls } = fakeDb();
    expect(await run(client, "owner", "owner")).toEqual({ ok: false, status: 409, error: OWNER_MUST_HAND_OVER });
    expect(calls).toEqual([]);
  });
  it("a member can leave", async () => {
    const { client, calls } = fakeDb();
    expect(await run(client, "m1", "m1")).toEqual({ ok: true, kind: "left", tripName: "Araku weekend" });
    expect(calls).toEqual(["delete:trip_members"]);
  });
  it("the owner can remove a member; a member cannot remove anyone", async () => {
    const a = fakeDb();
    expect(await run(a.client, "owner", "m1")).toMatchObject({ ok: true, kind: "removed" });
    const b = fakeDb();
    expect(await run(b.client, "m1", "m2")).toEqual({ ok: false, status: 403, error: "Only the trip owner can remove members." });
    expect(b.calls).toEqual([]);
  });
  it("someone who is not on the trip any more → 404; a trip I can't see → 404", async () => {
    expect(await run(fakeDb({ deleted: 0 }).client, "owner", "m1")).toMatchObject({ ok: false, status: 404 });
    expect(await run(fakeDb({ trip: null }).client, "owner", "m1")).toMatchObject({ ok: false, status: 404 });
  });
  it("their stored trip photos are removed first; if that can't happen, nothing changes", async () => {
    const media = [{ file_url: `${SB}/storage/v1/object/public/trip-media/m1/a.jpg` }];
    const removed: string[] = [];
    const admin = { storage: { from: (b: string) => ({ remove: async (p: string[]) => { removed.push(...p.map((x) => `${b}:${x}`)); return { error: null }; } }) } } as unknown as SupabaseClient;
    const a = fakeDb({ media });
    expect((await run(a.client, "owner", "m1", admin)).ok).toBe(true);
    expect(removed).toEqual(["trip-media:m1/a.jpg"]);
    const b = fakeDb({ media });
    expect(await run(b.client, "owner", "m1", null)).toMatchObject({ ok: false, status: 503 });
    expect(b.calls).toEqual([]);
  });
});

describe("transferOwnership (server)", () => {
  it("calls the database function and turns its refusals into plain words", async () => {
    const ok = fakeDb();
    expect(await transferOwnership({ supabase: ok.client, tripId: TRIP, newOwnerId: "m1" })).toEqual({ ok: true });
    expect(ok.calls).toEqual([`rpc:transfer_trip_ownership:${JSON.stringify({ p_trip: TRIP, p_new_owner: "m1" })}`]);
    const cases: [string, number, RegExp][] = [["42501", 403, /Only the trip owner/], ["P0002", 400, /already on this trip/], ["22023", 400, /another member/], ["PGRST202", 503, /database update/]];
    for (const [code, status, msg] of cases) {
      const r = await transferOwnership({ supabase: fakeDb({ rpcError: { code, message: "x" } }).client, tripId: TRIP, newOwnerId: "m1" });
      expect(r).toMatchObject({ ok: false, status });
      expect((r as { error: string }).error).toMatch(msg);
    }
  });
});

describe("routes", () => {
  beforeEach(() => { serverUser.current = { id: "owner" }; process.env.NEXT_PUBLIC_SUPABASE_URL = SB; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon"; });
  it("bad ids → 400, signed out → 401", async () => {
    const del = (id: string, u: string) => memberDELETE(new Request("https://x", { method: "DELETE" }), { params: Promise.resolve({ id, userId: u }) });
    expect((await del("nope", TRIP)).status).toBe(400);
    expect((await del(TRIP, "nope")).status).toBe(400);
    serverUser.current = null;
    expect((await del(TRIP, TRIP)).status).toBe(401);
    const post = (body: unknown) => ownerPOST(new Request("https://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: TRIP }) });
    expect((await post({ user_id: TRIP })).status).toBe(401);
    serverUser.current = { id: "owner" };
    expect((await post({ user_id: "not-a-uuid" })).status).toBe(400);
  });
});

const member = (user_id: string, display_name: string): TripMember => ({ id: `m-${user_id}`, trip_id: TRIP, user_id, display_name, avatar_color: "#1C7C6D", joined_at: "2026-10-01T00:00:00Z" });
const MEMBERS = [member("owner", "Bhanu"), member("m1", "Ravi"), member("m2", "Sita")];

describe("MembersPanel", () => {
  const html = (userId: string, members = MEMBERS) => renderToStaticMarkup(createElement(MembersPanel, { tripId: TRIP, tripName: "Araku weekend", members, ownerId: "owner", userId }));
  it("owner view: Make owner + Remove for every other member, Leave for self", () => {
    const h = html("owner");
    expect(h.match(/>Remove</g)).toHaveLength(2);
    expect(h.match(/>Make owner</g)).toHaveLength(2);
    expect(h.match(/>Leave trip</g)).toHaveLength(1);
  });
  it("member view: only Leave, for themselves; nobody can be removed", () => {
    const h = html("m1");
    expect(h).not.toContain(">Remove<");
    expect(h).not.toContain(">Make owner<");
    expect(h.match(/>Leave trip</g)).toHaveLength(1);
  });

  let r: TestRenderer.ReactTestRenderer;
  let fetches: { url: string; method?: string; body?: string }[];
  let answers: { status: number; body: unknown }[];
  beforeEach(() => {
    fetches = []; answers = []; router.replace.mockClear(); router.refresh.mockClear(); browser.sent = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { fetches.push({ url, method: init.method, body: init.body as string }); const a = answers.shift() ?? { status: 200, body: { ok: true } }; return { ok: a.status < 300, status: a.status, json: async () => a.body }; });
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {}, localStorage: { length: 0, key: () => null, removeItem() {} } });
  });
  afterEach(() => { act(() => r?.unmount()); vi.unstubAllGlobals(); });
  const mount = (userId: string, members = MEMBERS) => act(() => { r = TestRenderer.create(createElement(MembersPanel, { tripId: TRIP, tripName: "Araku weekend", members, ownerId: "owner", userId })); });
  const btn = (label: string) => r.root.findAllByType("button").filter((b) => JSON.stringify(b.props.children).includes(label));
  const text = () => JSON.stringify(r.toJSON());

  it("a member leaves: confirm explains what happens, then goes to My trips and tells the others", async () => {
    mount("m1");
    await act(async () => { btn("Leave trip")[0].props.onClick(); });
    expect(text()).toContain("stops you added stay");
    await act(async () => { await btn("Leave trip").at(-1)!.props.onClick(); });
    expect(fetches[0]).toMatchObject({ url: `/api/trips/${TRIP}/members/m1`, method: "DELETE" });
    expect(browser.sent).toEqual([MEMBERS_CHANGED_BROADCAST]);
    expect(router.replace).toHaveBeenCalledWith("/trips?left=1");
  });

  it("the owner's Leave explains the two ways out; hand over then leave", async () => {
    mount("owner");
    await act(async () => { btn("Leave trip")[0].props.onClick(); });
    expect(text()).toContain("You own this trip");
    expect(text()).toContain("delete the trip");
    const go = () => btn("Hand over and leave")[0];
    expect(go().props.disabled).toBe(true); // a new owner must be chosen first
    act(() => { r.root.findByType("select").props.onChange({ target: { value: "m2" } }); });
    await act(async () => { await go().props.onClick(); });
    expect(fetches.map((f) => `${f.method} ${f.url}`)).toEqual([`POST /api/trips/${TRIP}/owner`, `DELETE /api/trips/${TRIP}/members/owner`]);
    expect(JSON.parse(fetches[0].body!)).toEqual({ user_id: "m2" });
    expect(router.replace).toHaveBeenCalledWith("/trips?left=1");
  });

  it("the only person on the trip is told to delete it instead (no hand-over button)", async () => {
    mount("owner", [MEMBERS[0]]);
    await act(async () => { btn("Leave trip")[0].props.onClick(); });
    expect(text()).toContain("only person on this trip");
    expect(btn("Hand over and leave")).toHaveLength(0);
  });

  it("the owner removes a member: confirm, request, refresh, tell the others; a refusal is shown", async () => {
    mount("owner");
    await act(async () => { btn("Remove")[0].props.onClick(); });
    expect(text()).toContain("Ravi");
    expect(text()).toContain("stops they added stay");
    await act(async () => { await btn("Remove").at(-1)!.props.onClick(); });
    expect(fetches[0]).toMatchObject({ url: `/api/trips/${TRIP}/members/m1`, method: "DELETE" });
    expect(router.refresh).toHaveBeenCalled();
    expect(browser.sent).toEqual([MEMBERS_CHANGED_BROADCAST]);
    answers.push({ status: 403, body: { error: "Only the trip owner can remove members." } });
    await act(async () => { btn("Remove")[0].props.onClick(); });
    await act(async () => { await btn("Remove").at(-1)!.props.onClick(); });
    expect(text()).toContain("Only the trip owner can remove members.");
  });
});

describe("the person who was removed sees a clear message", () => {
  let r: TestRenderer.ReactTestRenderer;
  let events: string[];
  beforeEach(() => {
    browser.tripRow = { id: "t" }; browser.tripError = null; browser.listeners = []; events = []; router.refresh.mockClear();
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {}, dispatchEvent: (e: Event) => { events.push(e.type); return true; }, localStorage: { length: 0, key: () => null, removeItem() {} } });
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("CustomEvent", class { type: string; constructor(t: string) { this.type = t; } });
  });
  afterEach(() => { act(() => r?.unmount()); vi.unstubAllGlobals(); });
  const OTHER = "11111111-0000-4000-8000-0000000000c9"; // not marked as "leaving here" by the panel tests
  const mount = () => act(() => { r = TestRenderer.create(createElement(TripGoneWatcher, { tripId: OTHER })); });
  const hint = async () => { await act(async () => { browser.listeners.filter((l) => l.event === MEMBERS_CHANGED_BROADCAST).forEach((l) => l.cb()); await Promise.resolve(); await Promise.resolve(); }); };

  it("removed (the trip is no longer visible to me) → 'You were removed from this trip', drive stops", async () => {
    mount();
    browser.tripRow = null;
    await hint();
    expect(JSON.stringify(r.toJSON())).toContain(TRIP_REMOVED_TITLE);
    expect(JSON.stringify(r.toJSON())).toContain("stops you added stay");
    expect(events).toEqual(["tm:trip-gone"]);
  });
  it("someone ELSE left (I still see the trip) → no message, the member list refreshes", async () => {
    mount();
    await hint();
    expect(r.toJSON()).toBeNull();
    expect(router.refresh).toHaveBeenCalled();
  });
  it("a check that fails (offline, server error) never says I was removed", async () => {
    mount();
    browser.tripRow = null; browser.tripError = { message: "503" };
    await hint();
    expect(r.toJSON()).toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
