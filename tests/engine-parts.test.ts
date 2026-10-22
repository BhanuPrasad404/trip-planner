import { describe, expect, it } from "vitest";
import { clockText, earliestSunset, sunsetAt } from "@/lib/engine/daylight";
import { fuelCost, fuelLabel, litres } from "@/lib/engine/fuel";
import { haltDrive, haltFor, pickTown } from "@/lib/engine/halts";
import { isHillPair, lineWithMargin, withMargin } from "@/lib/engine/margin";
import { PERMIT_CHECK, permitNotes } from "@/lib/engine/permits";
import { splitRoad } from "@/lib/engine/transit";
import { straightLine, townFinder, townsAlong } from "./engine-fixtures";

const HYD = { lat: 17.385, lng: 78.4867 }, MANALI = { lat: 32.2432, lng: 77.1892 };

describe("road margin", () => {
  it("adds 15% to every drive and 30% to hill drives; distances unchanged", () => {
    const m = { durations: [[0, 3600, 3600], [3600, 0, 3600], [3600, 3600, 0]], distances: [[0, 1, 2], [1, 0, 3], [2, 3, 0]], source: "osrm" };
    const r = withMargin(m, [500, 600, 1400]);
    expect(r.matrix.durations[0][1]).toBeCloseTo(3600 * 1.15);
    expect(r.matrix.durations[0][2]).toBeCloseTo(3600 * 1.3); // 900 m rise
    expect(r.matrix.durations[1][2]).toBeCloseTo(3600 * 1.3);
    expect(r.matrix.distances).toEqual(m.distances);
    expect(r.hill[0][2]).toBe(true);
    expect(r.hill[0][1]).toBe(false);
  });
  it("never guesses a hill drive from unknown heights", () => {
    expect(isHillPair(null, 2000)).toBe(false);
    expect(isHillPair(1300, 1250)).toBe(true); // both high: mountain road
    expect(isHillPair(100, 650)).toBe(false);
    const r = withMargin({ durations: [[0, 100], [100, 0]], distances: [[0, 1], [1, 0]], source: "osrm" }, null);
    expect(r.matrix.durations[0][1]).toBeCloseTo(115);
  });
  it("applies the margin piece by piece on a road line", () => {
    const l = lineWithMargin({ coords: [[0, 0], [0, 1], [0, 2]], durations: [100, 100], distances: [1, 1], hill: [false, true], source: "osrm" });
    expect(l.durations[0]).toBeCloseTo(115);
    expect(l.durations[1]).toBeCloseTo(130);
  });
});

describe("daylight", () => {
  it("gives a real sunset for Hyderabad in December (about 5:45 PM)", () => {
    const s = sunsetAt(HYD, "2026-12-15", 1)!;
    expect(s).toBeGreaterThan(17 * 60 + 30);
    expect(s).toBeLessThan(18 * 60);
    expect(clockText(s)).toMatch(/^5:\d\d PM$/);
  });
  it("earliest sunset over points and days is the minimum", () => {
    const pts = [HYD, { lat: 12.97, lng: 77.59 }];
    const e = earliestSunset(pts, "2026-06-15", 3)!;
    for (const p of pts) for (const d of [1, 2, 3]) expect(e).toBeLessThanOrEqual(sunsetAt(p, "2026-06-15", d)!);
  });
  it("clock text", () => { expect(clockText(0)).toBe("12:00 AM"); expect(clockText(12 * 60 + 5)).toBe("12:05 PM"); expect(clockText(1065)).toBe("5:45 PM"); });
});

describe("night halts", () => {
  const towns = townFinder([
    { name: "Bigtown", area: "X", lat: 17.6, lng: 78.5, pop: 80_000 },
    { name: "Hamlet", area: "X", lat: 17.41, lng: 78.49, pop: 2_000 },
  ]);
  it("prefers a 20k+ town within 25 km over a nearer small one", () => {
    const t = pickTown(towns, HYD)!;
    expect(t.name).toBe("Bigtown");
    expect(t.checkStays).toBe(false);
  });
  it("falls back to the nearest town, marked check stays", () => {
    const t = pickTown(townFinder([{ name: "Hamlet", area: "X", lat: 17.41, lng: 78.49, pop: 2_000 }]), HYD)!;
    expect(t.name).toBe("Hamlet");
    expect(t.checkStays).toBe(true);
  });
  it("returns no halt when no town at all is near (never invents one)", () => {
    expect(haltFor(1, { name: "Nowhere", ...HYD }, townFinder([]))).toBeNull();
  });
  it("sleeps at the stop when the stop is the town", () => {
    const h = haltFor(2, { name: "Bigtown", lat: 17.6, lng: 78.5 }, towns)!;
    expect(h.atStop).toBe(true);
    expect(h.km).toBe(0);
  });
  it("estimates the halt drive from the straight line", () => {
    expect(haltDrive(10)).toEqual({ km: 13.5, min: 20 });
  });
});

describe("splitting a long drive into drive days", () => {
  const line = straightLine(HYD, MANALI);
  const towns = townFinder(townsAlong(HYD, MANALI, 25));
  const budget = () => ({ driveMin: 600, daylightLimited: false });

  it("Hyderabad → Manali: every drive day within the budget, ends in a real town, adds up", () => {
    const sp = splitRoad(line, { startName: "Hyderabad", endName: "Manali", firstDay: 1, budget, towns });
    const total = line.durations.reduce((a, b) => a + b, 0) / 60;
    expect(sp.days.length).toBe(Math.ceil(total / 600) - 1);
    for (const d of sp.days) {
      expect(d.driveMin).toBeLessThanOrEqual(600); // the detour into town fits in the reserve
      expect(d.driveMin).toBeGreaterThan(600 - 90 - 30);
      expect(d.to).toMatch(/^T\d+$/);
    }
    expect(sp.days.map((d) => d.day)).toEqual(sp.days.map((_, i) => i + 1));
    expect(sp.days[0].from).toBe("Hyderabad");
    for (let i = 1; i < sp.days.length; i++) expect(sp.days[i].from).toBe(sp.days[i - 1].to);
    expect(sp.remainingMin).toBeLessThanOrEqual(600);
  });
  it("says so when no town is near the road (no invented halt)", () => {
    const sp = splitRoad(line, { startName: "Hyderabad", endName: "Manali", firstDay: 1, budget, towns: townFinder([]) });
    expect(sp.days.length).toBeGreaterThan(0);
    for (const d of sp.days) { expect(d.to).toMatch(/^the road near km \d+$/); expect(d.haltNote).toMatch(/No town near the road/); }
  });
  it("no drive days when the drive fits in a day", () => {
    const sp = splitRoad(straightLine(HYD, { lat: 17.0, lng: 79.0 }), { startName: "A", endName: "B", firstDay: 1, budget, towns });
    expect(sp.days).toEqual([]);
    expect(sp.arrival.name).toBe("A");
  });
  it("a hill stretch shortens the day", () => {
    const hilly = { ...line, hill: line.durations.map(() => true) };
    const b = (_d: number, _a: unknown, hill: boolean) => ({ driveMin: hill ? 480 : 600, daylightLimited: false });
    const sp = splitRoad(hilly, { startName: "A", endName: "B", firstDay: 1, budget: b, towns });
    expect(Math.max(...sp.days.map((d) => d.driveMin))).toBeLessThanOrEqual(480);
  });
});

describe("fuel", () => {
  it("litres first, rupees only with a typed price", () => {
    expect(litres(450, 15)).toBe(30);
    expect(litres(451, 15)).toBe(31);
    expect(litres(450, null)).toBeNull();
    expect(fuelCost(30, null)).toBeNull();
    expect(fuelCost(30, 106.5)).toBe(3195);
    expect(fuelLabel("car", 15)).toMatch(/15 km per litre \(a typical car; change it to your vehicle's\)/);
    expect(fuelLabel("bus", null)).toMatch(/aren't driving your own vehicle/);
  });
});

describe("permits", () => {
  it("only says MAY, and every line ends with the check sentence", () => {
    const notes = permitNotes([
      { name: "Tawang", lat: 27.586, lng: 91.859, state: "Arunachal Pradesh" },
      { name: "Gurudongmar Lake", lat: 28.024, lng: 88.709, state: "Sikkim" },
      { name: "Gangtok", lat: 27.33, lng: 88.61, state: "Sikkim" },
      { name: "Pangong Lake", lat: 33.758, lng: 78.664, state: "Ladakh" },
      { name: "Leh Palace", lat: 34.165, lng: 77.585, state: "Ladakh" },
      { name: "Rohtang Pass", lat: 32.371, lng: 77.246, state: "Himachal Pradesh" },
      { name: "Charminar", lat: 17.36, lng: 78.47, state: "Telangana" },
    ]);
    expect(notes).toHaveLength(4);
    for (const n of notes) { expect(n.endsWith(PERMIT_CHECK)).toBe(true); expect(n).toMatch(/may need|restricted/); expect(n).not.toMatch(/\b(open|closed|live|status)\b/i); }
    expect(notes.join(" ")).not.toMatch(/Gangtok|Leh Palace|Charminar/);
    expect(PERMIT_CHECK).toBe("Rules change, check the official site before you go.");
  });
});
