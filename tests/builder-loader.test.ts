import { beforeEach, describe, expect, it, vi } from "vitest";
import { roadMatrix } from "./builder-fixtures";

type Row = Record<string, unknown>;
const db: { trip: Row | null; places: Row[]; votes: Row[] } = { trip: null, places: [], votes: [] };
const seen: { matrixPoints: { lat: number; lng: number }[] | null; weatherRequests: unknown[] | null } = { matrixPoints: null, weatherRequests: null };

vi.mock("@/lib/routing", () => ({ getMatrix: async (pts: { lat: number; lng: number }[]) => ((seen.matrixPoints = pts), roadMatrix(pts)) }));
vi.mock("@/lib/providers/registry", () => ({
  weatherProvider: () => ({
    conditionsFor: async (reqs: { id: string }[]) => {
      seen.weatherRequests = reqs;
      // day 1 is stormy for everyone, day 2 is lovely
      return Object.fromEntries(reqs.map((r) => [r.id, r.id.endsWith("|1") ? { kind: "forecast", tempMaxC: 31, precipMmPerDay: 30, rainyDayShare: 0.9, sampleDays: 1 } : { kind: "forecast", tempMaxC: 27, precipMmPerDay: 0.2, rainyDayShare: 0, sampleDays: 1 }]));
    },
  }),
}));
const fakeSupabase = {
  from: (table: string) => {
    const result = () => (table === "trips" ? { data: db.trip, error: null } : table === "places" ? { data: db.places, error: null } : { data: db.votes, error: null });
    const q: Record<string, unknown> = {};
    q.select = () => q; q.eq = () => q;
    q.maybeSingle = async () => result();
    q.then = (res: (v: unknown) => unknown) => res(result());
    return q;
  },
};
import { loadBuilder } from "@/lib/server/builder";

const place = (id: string, name: string, lat: number, lng: number, extra: Row = {}): Row => ({ id, name, lat, lng, status: "planned", day_number: null, category: null, season_tags: null, ...extra });
const base = { endMode: "free" as const, todayISO: "2026-10-07", userId: "u1" };
beforeEach(() => {
  db.trip = { id: "t", num_days: 2, start_date: "2026-10-20", start_lat: 19.076, start_lng: 72.8777, start_city: "Mumbai", dest_lat: 18.5204, dest_lng: 73.8567, dest_name: "Pune" };
  db.places = [place("a", "Lonavala", 18.7546, 73.4062, { category: "hill_station", priority: "must", visit_minutes: 90 }), place("b", "Pune Fort", 18.5204, 73.8567, { category: "fort" })];
  db.votes = [{ place_id: "b", user_id: "x", vote: 1 }];
  seen.matrixPoints = null; seen.weatherRequests = null;
});

describe("loadBuilder: everything is read from the trip, not guessed", () => {
  it("builds the planner input from the trip, its places, priorities, votes and real road matrix", async () => {
    const r = await loadBuilder(fakeSupabase as never, "t", base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.places.map((p) => [p.id, p.priority, p.visitMin, p.category])).toEqual([["a", "must", 90, "hill_station"], ["b", "normal", null, "fort"]]);
    expect(r.input.places[1].vote).toBeGreaterThan(0);                           // votes reach the planner
    expect(r.input.numDays).toBe(2);
    expect(seen.matrixPoints).toHaveLength(3);                                    // start + 2 places (no end point in "free" mode)
    expect(r.result.options.map((o) => o.style)).toEqual(["balanced", "relaxed", "explorer"]);
    expect(r.signature).toMatch(/^[0-9a-f]{64}$/);
  });
  it("opening hours are NOT invented: user-added places have none, so every stop is 'hours unknown'", async () => {
    const r = await loadBuilder(fakeSupabase as never, "t", base);
    if (!r.ok) throw new Error("expected ok");
    expect(r.input.places.every((p) => p.hours === null)).toBe(true);
    expect(r.result.options[0].warnings.some((w) => w.code === "hours_unknown")).toBe(true);
  });
  it("asks the weather provider for every place on every trip day and feeds the fit into the plan", async () => {
    const r = await loadBuilder(fakeSupabase as never, "t", base);
    if (!r.ok) throw new Error("expected ok");
    expect(seen.weatherRequests).toHaveLength(4);                                 // 2 places × 2 days
    const fit = r.input.places[1].fit!;
    expect(fit[0]).toBeLessThan(fit[1]!);                                         // stormy day 1 scores worse than lovely day 2 for a fort
    expect(r.input.places[1].fitNote![0]).toMatch(/31°C, ~30 mm rain/);
  });
  it("includes the end point only when asked, and a round trip needs no extra routing point", async () => {
    const withEnd = await loadBuilder(fakeSupabase as never, "t", { ...base, endMode: "point" });
    if (!withEnd.ok) throw new Error("expected ok");
    expect(withEnd.input.endMode).toBe("point");
    expect(seen.matrixPoints).toHaveLength(4);
    await loadBuilder(fakeSupabase as never, "t", { ...base, endMode: "start" });
    expect(seen.matrixPoints).toHaveLength(3);
    db.trip = { ...db.trip!, dest_lat: null, dest_lng: null };
    const noDest = await loadBuilder(fakeSupabase as never, "t", { ...base, endMode: "point" });
    if (!noDest.ok) throw new Error("expected ok");
    expect(noDest.input.endMode).toBe("free");                                    // no destination to end at: falls back honestly
  });
  it("works without trip dates (no weather requested, no dates on days)", async () => {
    db.trip = { ...db.trip!, start_date: null };
    const r = await loadBuilder(fakeSupabase as never, "t", base);
    if (!r.ok) throw new Error("expected ok");
    expect(seen.weatherRequests).toBeNull();
    expect(r.result.options[0].days.every((d) => d.date === null)).toBe(true);
  });
  it("refuses cleanly: no start point, a trip already under way, too many places, missing trip", async () => {
    db.trip = { ...db.trip!, start_lat: null };
    expect(await loadBuilder(fakeSupabase as never, "t", base)).toMatchObject({ ok: false, status: 422 });
    db.trip = { ...db.trip!, start_lat: 19 };
    db.places = [place("a", "A", 18, 73, { status: "done" })];
    const live = await loadBuilder(fakeSupabase as never, "t", base);
    expect(live).toMatchObject({ ok: false, status: 409 });
    expect(live.ok ? "" : live.error).toMatch(/Re-plan from now/);
    db.places = Array.from({ length: 41 }, (_, i) => place(`p${i}`, `P${i}`, 18 + i * 0.01, 73));
    expect(await loadBuilder(fakeSupabase as never, "t", base)).toMatchObject({ ok: false, status: 422 });
    db.trip = null;
    expect(await loadBuilder(fakeSupabase as never, "t", base)).toMatchObject({ ok: false, status: 404 });
  });
});
