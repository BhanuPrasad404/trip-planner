import { describe, expect, it } from "vitest";
import { orderStops, planTrip } from "@/lib/planner";
import { estimateMatrix } from "@/lib/routing";

// Points on a line heading east from the start (index 0): 0, 1, 2, ... (1° lng ≈ 105 km at 18°N)
const line = (xs: number[]) => estimateMatrix([{ lat: 18, lng: 73 }, ...xs.map((x) => ({ lat: 18, lng: 73 + x }))]);

describe("orderStops", () => {
  it("visits stops along the road in order (no zig-zag), regardless of input order", () => {
    const m = line([0.3, 0.1, 0.2]); // input order scrambled: indices 1,2,3 are at 0.3, 0.1, 0.2
    expect(orderStops(3, m.durations)).toEqual([2, 3, 1]);
  });
  it("2-opt fixes a crossing that nearest-neighbour creates", () => {
    // Hand-made asymmetric-free matrix where greedy picks a bad first hop.
    const d = [
      [0, 1, 4, 5],
      [1, 0, 6, 1],
      [4, 6, 0, 2],
      [5, 1, 2, 0],
    ];
    const order = orderStops(3, d);
    const cost = [0, ...order].reduce((s, v, i, a) => (i ? s + d[a[i - 1]][v] : 0), 0);
    expect(cost).toBeLessThanOrEqual(4); // optimal open path: 0→1→3→2 = 1+1+2
  });
});

describe("planTrip", () => {
  it("splits by hours, numbers stops 1..n per day, sets drive legs and increasing times", () => {
    const stops = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, visitHours: 3 }));
    const r = planTrip(stops, 3, line([0.1, 0.15, 0.2, 0.25, 0.3, 0.35]));
    expect(new Set(r.stops.map((s) => s.day_number)).size).toBeGreaterThan(1);
    for (const day of new Set(r.stops.map((s) => s.day_number))) {
      const ds = r.stops.filter((s) => s.day_number === day);
      expect(ds.map((s) => s.sequence_order)).toEqual(ds.map((_, i) => i + 1));
      const times = ds.map((s) => s.arrival_time);
      expect([...times].sort()).toEqual(times); // monotonically increasing within a day
    }
    expect(r.stops[0].drive_minutes).toBeGreaterThan(0);
    expect(r.stops[0].drive_km).toBeGreaterThan(0);
  });

  it("a long drive counts toward the day: a far stop gets its own day instead of cramming", () => {
    // stop A is 1 h away, stop B is a further ~8 h drive (≈ 8*45/1.35 km ≈ 267 km ≈ 2.5°)
    const r = planTrip([{ id: "A", visitHours: 2 }, { id: "B", visitHours: 2 }], 3, line([0.4, 3.0]));
    const byId = Object.fromEntries(r.stops.map((s) => [s.id, s]));
    expect(byId.B.day_number).toBeGreaterThan(byId.A.day_number);
  });

  it("warns about over-long days and flags overflow when days are insufficient", () => {
    const stops = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, visitHours: 5 }));
    const r = planTrip(stops, 2, line([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]), { names: {} });
    expect(r.overflow).toBe(true);
    expect(r.warnings.some((w) => /Day 2 is long/.test(w))).toBe(true);
    expect(Math.max(...r.stops.map((s) => s.day_number))).toBe(2); // never invents extra days
  });

  it("mentions when driving times are only estimates", () => {
    expect(planTrip([{ id: "A", visitHours: 1 }], 1, line([0.1])).warnings.join(" ")).toMatch(/estimates/);
  });

  it("handles empty input and a single huge stop", () => {
    expect(planTrip([], 3, line([])).stops).toEqual([]);
    const r = planTrip([{ id: "A", visitHours: 12 }], 3, line([0.1]));
    expect(r.stops[0].day_number).toBe(1);
  });
});
