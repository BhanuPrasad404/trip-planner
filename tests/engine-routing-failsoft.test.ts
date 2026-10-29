// Routing failures must never empty a plan (handoff finding F8, regression tests T5, T7, T8, T12).
// The failing run: Hyderabad round trip to Vijayawada, Visakhapatnam, Araku Valley and Rajamahendravaram in 4 days. The routing service
// didn't answer, so the road table was ESTIMATED; the engine then fetched no road line for the long drive, made no drive days, treated
// every far place as an impossible day trip, dropped all 4 and showed 4 empty days. The cities are a FIXTURE here, never in the logic.
import { describe, expect, it } from "vitest";
import { ESTIMATE_KEEP_NOTE, planTrip } from "@/lib/engine/plan";
import { estimateMatrix, estimateRoadLine } from "@/lib/providers/estimate";
import type { EnginePlan } from "@/lib/engine/types";
import type { BuilderInput } from "@/lib/trip-builder";
import { roadMatrix } from "./builder-fixtures";
import { engineInput, townFinder, townsAlong } from "./engine-fixtures";

const HYD = { lat: 17.385, lng: 78.4867, label: "Hyderabad" };
const PLACES = [
  { id: "vja", name: "Vijayawada", lat: 16.5062, lng: 80.648 },
  { id: "vsk", name: "Visakhapatnam", lat: 17.6868, lng: 83.2185 },
  { id: "ark", name: "Araku Valley", lat: 18.3273, lng: 82.8775 },
  { id: "rjy", name: "Rajamahendravaram", lat: 17.0005, lng: 81.804 },
].map((p) => ({ ...p, category: "other" as const, priority: "normal" as const, visitMin: null, hours: null }));
const TOWNS = townFinder([...townsAlong(HYD, PLACES[0], 30), ...townsAlong(PLACES[0], PLACES[1], 30)]);

function input(matrixSource: "estimate" | "osrm", numDays = 4): BuilderInput {
  const pts = [HYD, ...PLACES];
  return { places: PLACES, start: HYD, end: null, endMode: "start", numDays, startDateISO: "2026-12-12", utcOffsetMin: 330, matrix: matrixSource === "estimate" ? estimateMatrix(pts) : roadMatrix(pts, 55, 1.25) };
}
const scheduled = (p: EnginePlan) => p.variants.map((v) => new Set(v.option.days.flatMap((d) => d.stops.map((s) => s.placeId))).size);

describe("estimated road line", () => {
  it("matches the estimated table's time and distance (so the two never disagree), in short pieces", () => {
    const line = estimateRoadLine(HYD, PLACES[0]);
    const m = estimateMatrix([HYD, PLACES[0]]);
    const sec = line.durations.reduce((s, x) => s + x, 0), metres = line.distances.reduce((s, x) => s + x, 0);
    expect(Math.abs(sec - m.durations[0][1]) / m.durations[0][1]).toBeLessThan(0.001);
    expect(Math.abs(metres - m.distances[0][1]) / m.distances[0][1]).toBeLessThan(0.001);
    expect(line.source).toBe("estimate");
    expect(line.coords.length).toBe(line.durations.length + 1);
    expect(Math.max(...line.distances)).toBeLessThanOrEqual(2_000 * 1.35 + 1);
  });
});

describe("T12: the earlier failing run (estimated table, no road line) no longer drops every place", () => {
  it("BEFORE the fix this dropped all 4 places; now every place is kept in every plan, with the reason said", () => {
    const plan = planTrip(engineInput(input("estimate"), { towns: TOWNS, outLine: null }));
    for (const v of plan.variants) expect(v.option.removed).toEqual([]);
    expect(scheduled(plan)).toEqual([4, 4, 4]);
    expect(plan.notes).toContain(ESTIMATE_KEEP_NOTE);
    expect(plan.labels.roads).toBe("estimated");
  });
});

describe("T5/T8: estimated table AND estimated road line (what the server now passes when routing is down)", () => {
  const plan = planTrip(engineInput(input("estimate"), { towns: TOWNS, outLine: estimateRoadLine(HYD, PLACES[0]) }));
  it("keeps all 4 places in every plan, and makes real drive days with halt towns", () => {
    for (const v of plan.variants) expect(v.option.removed).toEqual([]);
    expect(scheduled(plan)).toEqual([4, 4, 4]);
    expect(plan.variants.every((v) => v.transitOut.length > 0 || v.option.days.some((d) => d.stops.length))).toBe(true);
  });
  it("no plan is the empty 'no day left' plan, and no day among the places is empty", () => {
    for (const v of plan.variants) {
      expect(v.option.days.length).toBeGreaterThan(0);
      expect(v.option.days.every((d) => d.stops.length > 0)).toBe(true);
    }
  });
  it("says the long drive is worked out on an ESTIMATED road, and flags (never hides) days that don't fit", () => {
    expect(plan.warnings.some((w) => w.code === "estimated_times" && /estimated road/.test(w.message))).toBe(true);
    for (const v of plan.variants) if (!v.feasible) expect(v.option.warnings.length + v.option.removed.length).toBeGreaterThan(0);
  });
});

describe("T7: real road table but the road line is missing", () => {
  it("an estimated line still gives drive days, and the roads are labelled partly estimated", () => {
    const plan = planTrip(engineInput(input("osrm", 6), { towns: TOWNS, outLine: estimateRoadLine(HYD, PLACES[0]) }));
    expect(plan.labels.roads).toBe("partly estimated");
    expect(plan.variants.some((v) => v.transitOut.length > 0)).toBe(true);
    expect(plan.notes).not.toContain(ESTIMATE_KEEP_NOTE);                    // real table: places may be left out, with reasons, as before
  });
});
