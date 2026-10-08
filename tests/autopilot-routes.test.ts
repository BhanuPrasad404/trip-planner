import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const TRIP = "00000000-0000-0000-0000-000000000001";
const OTHER_TRIP_PLACE = "00000000-0000-0000-0000-0000000000ff";
const id = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

const state = { user: { id: "me" } as { id: string } | null, quotaOk: true, places: [] as Row[], reports: [] as Row[], trip: { id: TRIP, num_days: 3 } as unknown, failShift: false, nextId: 90 };

// A tiny in-memory stand-in for the database: enough of the query builder for these routes.
function table(name: string) {
  let op = "select";
  let payload: unknown;
  const filters: ((r: Row) => boolean)[] = [];
  const b: Record<string, unknown> = {};
  const rows = () => (name === "places" ? state.places : name === "place_reports" ? state.reports : []);
  const run = () => {
    if (name === "places" && op === "insert") {
      const row = { id: id(state.nextId++), ...(payload as Row) };
      state.places.push(row);
      return { data: [row], error: null };
    }
    if (name === "places" && op === "upsert") {
      if (state.failShift) return { data: null, error: { code: "XX000", message: "boom" } };
      for (const r of payload as Row[]) {
        const i = state.places.findIndex((p) => p.id === r.id);
        if (i >= 0) state.places[i] = { ...state.places[i], ...r };
        else state.places.push(r);
      }
      return { data: null, error: null };
    }
    if (name === "places" && op === "delete") {
      const gone = state.places.filter((r) => filters.every((f) => f(r)));
      state.places = state.places.filter((r) => !gone.includes(r));
      return { data: gone, error: null };
    }
    return { data: rows().filter((r) => filters.every((f) => f(r))), error: null };
  };
  Object.assign(b, {
    select: () => b, order: () => b, limit: () => b, gte: () => b, lte: () => b,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
    in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
    insert: (p: unknown) => ((op = "insert"), (payload = p), b),
    upsert: (p: unknown) => ((op = "upsert"), (payload = p), b),
    delete: () => ((op = "delete"), b),
    maybeSingle: async () => ({ data: name === "trips" ? state.trip : (run().data as Row[])?.[0] ?? null, error: null }),
    single: async () => ({ data: (run().data as Row[])[0], error: null }),
    then: (res: (v: unknown) => unknown) => res(run()),
  });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: state.quotaOk, error: null }),
    from: (t: string) => table(t),
    storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://sb.example/${p}` } }) }) },
  }),
}));
vi.mock("@/lib/providers/registry", () => ({
  weatherProvider: () => ({ id: "t", hourly: async () => [{ time: new Date(Date.now() - 600_000).toISOString(), tempC: 28, precipMm: 0, precipProb: 10 }], conditionsFor: async () => ({}) }),
}));

import { POST as insertPOST } from "@/app/api/trips/[id]/insert-stop/route";
import { POST as restorePOST } from "@/app/api/trips/[id]/restore/route";
import { POST as pulsePOST } from "@/app/api/pulse/route";

const ctx = (t = TRIP) => ({ params: Promise.resolve({ id: t }) });
const post = (fn: (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>, body: unknown, t = TRIP) => fn(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), ctx(t));
const stop = (n: number, day: number, seq: number, status = "planned", extra: Row = {}): Row => ({ id: id(n), trip_id: TRIP, name: `S${n}`, lat: 17, lng: 80 + n / 100, day_number: day, sequence_order: seq, status, arrival_time: "10:00:00", drive_minutes: 20, drive_km: 12, ...extra });

beforeEach(() => {
  state.user = { id: "me" };
  state.quotaOk = true;
  state.trip = { id: TRIP, num_days: 3 };
  state.failShift = false;
  state.nextId = 90;
  state.reports = [];
  state.places = [stop(1, 1, 1, "done"), stop(2, 1, 2), stop(3, 1, 3), stop(4, 2, 1)];
});

describe("POST /api/trips/[id]/insert-stop (Go There)", () => {
  const body = { name: "Hill Viewpoint", lat: 17.1, lng: 80.2, day_number: 1 };

  it("requires sign-in, valid input, a real trip and a real day", async () => {
    state.user = null;
    expect((await post(insertPOST, body)).status).toBe(401);
    state.user = { id: "me" };
    expect((await post(insertPOST, { ...body, lat: 999 })).status).toBe(400);
    expect((await post(insertPOST, { ...body, day_number: 9 })).status).toBe(400); // trip has 3 days
    state.trip = null;
    expect((await post(insertPOST, body)).status).toBe(404);
  });

  it("adds it as the NEXT stop (after what's already done), pushes the rest of the day later, and deletes nothing", async () => {
    const res = await post(insertPOST, body);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, shifted: 2, needsReplan: true });
    const day1 = state.places.filter((p) => p.day_number === 1).sort((a, b) => (a.sequence_order as number) - (b.sequence_order as number));
    expect(day1.map((p) => p.name)).toEqual(["S1", "Hill Viewpoint", "S2", "S3"]);
    expect(state.places).toHaveLength(5); // nothing removed
    // shifted stops lose their now-wrong times; the finished stop and other days are untouched
    expect(day1.find((p) => p.name === "S2")).toMatchObject({ arrival_time: null, sequence_order: 3 });
    expect(day1.find((p) => p.name === "S1")).toMatchObject({ arrival_time: "10:00:00", status: "done" });
    expect(state.places.find((p) => p.name === "S4")).toMatchObject({ sequence_order: 1, arrival_time: "10:00:00" });
  });

  it("leaves no half-done change if shifting fails", async () => {
    state.failShift = true;
    expect((await post(insertPOST, body)).status).toBe(500);
    expect(state.places.some((p) => p.name === "Hill Viewpoint")).toBe(false);
  });

  it("refuses beyond the per-trip limit", async () => {
    state.places = Array.from({ length: 200 }, (_, i) => stop(i % 80 + 1, 1, i, "planned", { id: `00000000-0000-0000-0000-${String(1000 + i).padStart(12, "0")}` }));
    expect((await post(insertPOST, body)).status).toBe(422);
  });
});

describe("POST /api/trips/[id]/restore (Undo)", () => {
  it("puts stops back exactly as they were and removes what the action added", async () => {
    const before = state.places.map((p) => ({ ...p }));
    const inserted = (await (await post(insertPOST, { name: "Viewpoint", lat: 17, lng: 80.3, day_number: 1 })).json()).id;
    const snapshot = before.map((p) => ({ id: p.id, day_number: p.day_number, sequence_order: p.sequence_order, arrival_time: p.arrival_time, drive_minutes: p.drive_minutes, drive_km: p.drive_km, status: p.status }));
    const res = await post(restorePOST, { places: snapshot, delete_ids: [inserted] });
    expect(await res.json()).toMatchObject({ ok: true, restored: 4, removed: 1 });
    for (const b of before) expect(state.places.find((p) => p.id === b.id)).toMatchObject({ day_number: b.day_number, sequence_order: b.sequence_order, arrival_time: b.arrival_time });
    expect(state.places.some((p) => p.id === inserted)).toBe(false);
  });

  it("can undo a skip / move, keeping the finished stop's status", async () => {
    state.places = state.places.map((p) => (p.id === id(2) ? { ...p, status: "skipped", day_number: 2 } : p));
    await post(restorePOST, { places: [{ id: id(2), day_number: 1, sequence_order: 2, arrival_time: "10:00", drive_minutes: 20, drive_km: 12, status: "planned" }], delete_ids: [] });
    expect(state.places.find((p) => p.id === id(2))).toMatchObject({ day_number: 1, status: "planned", status_at: null });
  });

  it("ignores stops that are not part of this trip, and validates input", async () => {
    const foreign = { id: OTHER_TRIP_PLACE, day_number: 1, sequence_order: 1, arrival_time: null, drive_minutes: null, drive_km: null, status: "planned" };
    const res = await post(restorePOST, { places: [foreign], delete_ids: [OTHER_TRIP_PLACE] });
    expect(await res.json()).toMatchObject({ restored: 0, removed: 0 });
    expect((await post(restorePOST, { places: [{ ...foreign, status: "gone" }] })).status).toBe(400);
    state.user = null;
    expect((await post(restorePOST, { places: [] })).status).toBe(401);
  });
});

describe("POST /api/pulse", () => {
  const body = { lat: 17, lng: 80, name: "Kondapalli Fort", hours: "24/7", hours_checked_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), utc_offset_min: 330 };
  const report = (user: string, tags: string[], minsAgo: number, extra: Row = {}) => ({ user_id: user, tags, note: null, photo_path: null, created_at: new Date(Date.now() - minsAgo * 60_000).toISOString(), lat: 17, lng: 80, ...extra });

  it("requires sign-in and valid input, and respects the daily limit", async () => {
    state.user = null;
    expect((await pulsePOST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }))).status).toBe(401);
    state.user = { id: "me" };
    expect((await pulsePOST(new Request("http://x", { method: "POST", body: JSON.stringify({ ...body, lat: 999 }) }))).status).toBe(400);
    state.quotaOk = false;
    expect((await pulsePOST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }))).status).toBe(429);
  });

  it("combines map hours, the forecast and fresh traveler reports — with a visible conflict — and never reveals who reported", async () => {
    state.reports = [report("alice", ["closed"], 18), report("bob", ["closed"], 25, { photo_path: "bob/p.jpg" })];
    const json = await (await pulsePOST(new Request("http://x", { method: "POST", body: JSON.stringify({ ...body, include_photos: true }) }))).json();
    expect(json.pulse.conflicts[0].detail).toMatch(/Map data says open, but 2 travelers reported it closed/);
    expect(json.pulse.signals.map((s: { source: string }) => s.source)).toEqual(expect.arrayContaining(["recent", "forecast", "map-data"]));
    expect(json.pulse.photos[0].url).toBe("https://sb.example/bob/p.jpg");
    expect(JSON.stringify(json)).not.toMatch(/alice|bob\b(?!\/)/);
    expect(JSON.stringify(json)).not.toContain("user_id");
  });

  it("does not show nearby travelers' photos for a Radar place unless the caller is a trip stop", async () => {
    state.reports = [report("bob", ["crowded"], 25, { photo_path: "bob/waterfall.jpg" })];
    const json = await (await pulsePOST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }))).json();
    expect(json.pulse.photos).toEqual([]);
    expect(JSON.stringify(json)).not.toContain("waterfall.jpg");
  });
});
