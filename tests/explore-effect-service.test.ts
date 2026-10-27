// previewAddStop: the whole read-only path with a fake database and a fake routing service.
import { describe, expect, it } from "vitest";
import { previewAddStop } from "@/lib/server/explore-effect";

const TRIP = { id: "t1", start_date: "2026-11-05", num_days: 2, start_lat: 17.0, start_lng: 78.0, resumed_at: null, closed_at: null };
const P = (id: string, day: number | null, seq: number, over: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), lat: 17.0, lng: 78 + seq / 2, day_number: day, sequence_order: seq, status: "planned", arrival_time: null, opening_hours: null, ...over });
function fakeDb(trip: unknown, places: unknown[]) {
  return { from: (t: string) => { const b: Record<string, unknown> = {}; b.select = () => b; b.eq = () => b; b.maybeSingle = async () => ({ data: t === "trips" ? trip : null, error: null }); b.limit = async () => ({ data: places, error: null }); return b; } } as never;
}
const matrixOf = (secs: number[][], source = "osrm") => async () => ({ durations: secs, distances: secs, source });
const today = async () => "2026-10-27";
const place = { name: "Borra Caves", lat: 17.1, lng: 78.6, category: "museum" as const };

describe("previewAddStop", () => {
  it("not a member (or no trip) → not found", async () => {
    expect(await previewAddStop(fakeDb(null, []), { tripId: "x", day: null, place }, { today })).toEqual({ error: "not_found" });
  });
  it("suggests the day of the nearest planned stop, and asks the road times start → stops still to do → the new place", async () => {
    let asked: unknown[] = [];
    const routing = { matrix: async (pts: unknown[]) => { asked = pts; return { durations: [[0, 3600, 2000], [3600, 0, 900], [2000, 900, 0]], distances: [], source: "osrm" }; } };
    const a = await previewAddStop(fakeDb(TRIP, [P("a", 1, 1, { arrival_time: "10:00:00" }), P("far", 2, 1, { lat: 20, lng: 80 })]), { tripId: "t1", day: null, place }, { routing: routing as never, today });
    if ("error" in a) throw new Error("x");
    expect(a.day).toBe(1); expect(a.days).toBe(2); expect(a.dayDate).toBe("2026-11-05");
    expect(asked).toHaveLength(3);                                         // the trip start, stop A, the new place
    expect(a.effect.visitMin).toBeGreaterThanOrEqual(15);
    expect(a.effect.basis).toBe("road");
  });
  it("a day the person picked is used (and kept within the trip)", async () => {
    const a = await previewAddStop(fakeDb(TRIP, [P("a", 1, 1)]), { tripId: "t1", day: 9, place }, { routing: { matrix: matrixOf([[0, 600], [600, 0]]) } as never, today });
    if ("error" in a) throw new Error("x");
    expect(a.day).toBe(2);
  });
  it("dates over and not resumed: no date, so hours and sunset are said to be unknown (never checked against a gone day)", async () => {
    const a = await previewAddStop(fakeDb({ ...TRIP, start_date: "2026-10-01" }, [P("a", 1, 1, { arrival_time: "10:00" })]), { tripId: "t1", day: 1, place }, { routing: { matrix: matrixOf([[0, 600, 600], [600, 0, 300], [600, 300, 0]]) } as never, today });
    if ("error" in a) throw new Error("x");
    expect(a.dayDate).toBeNull();
    expect(a.effect.unknowns.join(" ")).toMatch(/no dates/);
  });
  it("estimated road times are labelled as such", async () => {
    const a = await previewAddStop(fakeDb(TRIP, []), { tripId: "t1", day: 1, place }, { routing: { matrix: matrixOf([[0, 600], [600, 0]], "estimate") } as never, today });
    if ("error" in a) throw new Error("x");
    expect(a.effect.basis).toBe("estimate");
    expect(a.effect.unknowns.join(" ")).toMatch(/estimated/);
  });
});
