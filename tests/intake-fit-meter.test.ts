import { describe, expect, it } from "vitest";
import { categoryFor, fitMeter, type MeterPlace } from "@/lib/intake/fit-meter";
import { estimateMatrix } from "@/lib/providers/estimate";

// Hyderabad and real places around it. Road times come from the straight-line estimate here (the routing service is not called in
// tests); the meter must say "estimated" when that is what it got.
const HYD = { lat: 17.385, lng: 78.4867, name: "Hyderabad" };
const P = (id: string, name: string, lat: number, lng: number, kind: MeterPlace["kind"] = "sight", must = false): MeterPlace => ({ id, name, lat, lng, kind, must });
const NEAR = [P("w", "Warangal Fort", 17.95, 79.617), P("r", "Ramappa Temple", 18.259, 79.943), P("l", "Laknavaram Lake", 18.155, 80.03, "water")];
const FAR = [...NEAR, P("a", "Araku Valley", 18.327, 82.877, "subdistrict"), P("v", "Vizag beach", 17.71, 83.32, "coast"), P("g", "Gandikota", 14.81, 78.28), P("b", "Belum Caves", 15.1, 78.11)];
/** Six real places within a few hours of Hyderabad: a good 2–3 day trip, too much for one day. */
const WEEKEND = [...NEAR, P("y", "Yadagirigutta Temple", 17.587, 78.944), P("bh", "Bhongir Fort", 17.51, 78.889), P("ng", "Nagarjuna Sagar Dam", 16.575, 79.312, "water")];
const matrixFor = (places: MeterPlace[]) => estimateMatrix([HYD, ...places]);

describe("the fit meter — the engine's real fit check, in words", () => {
  it("3 nearby places in 3 days: fits easily", () => {
    const m = fitMeter({ answers: { days: 3 }, start: HYD, places: NEAR, matrix: matrixFor(NEAR) });
    expect(m.level).toBe("easy");
    expect(m.headline).toBe("Fits easily in 3 days");
    expect(m.kept).toBe(3);
    expect(m.estimated).toBe(true);
  });
  it("too many places for 1 day: says plainly it doesn't all fit, and how many days would", () => {
    const m = fitMeter({ answers: { days: 1 }, start: HYD, places: WEEKEND, matrix: matrixFor(WEEKEND) });
    expect(m.level).toBe("over");
    expect(m.headline).toMatch(/^Doesn't all fit: \d of 6 places in 1 day$/);
    expect(m.needDays).toBeGreaterThan(1);
    expect(m.detail).toMatch(/All of them need about \d+ days/);
    expect(m.leftOut.length).toBe(6 - m.kept);
    expect(m.leftOut[0].reason.length).toBeGreaterThan(10); // the engine's own reason, not a made-up one
  });
  it("places too far for ONE day's drive: says so, and does not promise that more days would help", () => {
    const m = fitMeter({ answers: { days: 2 }, start: HYD, places: FAR, matrix: matrixFor(FAR) });
    expect(m.level).toBe("over");
    expect(m.headline).toMatch(/^Doesn't all fit: \d of 7 places in 2 days$/);
    expect(m.detail).toMatch(/too far for one day's drive/);
    expect(m.needDays).toBeNull();
  });
  it("updates live with the answers: more days → fits; relaxed pace → fewer places fit", () => {
    const tight = fitMeter({ answers: { days: 1 }, start: HYD, places: WEEKEND, matrix: matrixFor(WEEKEND) });
    const more = fitMeter({ answers: { days: tight.needDays! }, start: HYD, places: WEEKEND, matrix: matrixFor(WEEKEND) });
    expect(more.level === "easy" || more.level === "tight").toBe(true);
    const packed = fitMeter({ answers: { days: 3, pace: "packed" }, start: HYD, places: FAR, matrix: matrixFor(FAR) });
    const relaxed = fitMeter({ answers: { days: 3, pace: "relaxed" }, start: HYD, places: FAR, matrix: matrixFor(FAR) });
    expect(relaxed.kept).toBeLessThanOrEqual(packed.kept);
  });
  it("a must-see is never dropped to make it fit", () => {
    const places = FAR.map((p) => (p.id === "b" ? { ...p, must: true } : p));
    const m = fitMeter({ answers: { days: 2 }, start: HYD, places, matrix: matrixFor(places) });
    expect(m.leftOut.map((l) => l.name)).not.toContain("Belum Caves");
  });
  it("the driving limit counts: 2 hours a day can't reach Vizag in a day", () => {
    const m = fitMeter({ answers: { days: 4, maxDriveHours: 2 }, start: HYD, places: FAR, matrix: matrixFor(FAR) });
    expect(m.leftOut.map((l) => l.name)).toEqual(expect.arrayContaining(["Vizag beach"]));
  });
  it("missing pieces are said, not guessed", () => {
    expect(fitMeter({ answers: { days: 3 }, start: null, places: NEAR, matrix: null }).headline).toBe("Add where you start");
    expect(fitMeter({ answers: {}, start: HYD, places: NEAR, matrix: matrixFor(NEAR) }).headline).toBe("How many days?");
    expect(fitMeter({ answers: { days: 3 }, start: HYD, places: [], matrix: null }).headline).toBe("Add places to see if it fits");
    expect(fitMeter({ answers: { days: 3 }, start: HYD, places: NEAR, matrix: null }).headline).toBe("Checking the roads…");
    // road times for a DIFFERENT set of places are never used
    expect(fitMeter({ answers: { days: 3 }, start: HYD, places: FAR, matrix: matrixFor(NEAR) }).level).toBe("unknown");
  });
  it("fast enough to run on every tap (40 places, 10 days, well under 300 ms)", () => {
    const many: MeterPlace[] = Array.from({ length: 40 }, (_, i) => P(`p${i}`, `Place ${i}`, 15 + (i % 8) * 0.4, 76 + Math.floor(i / 8) * 0.6));
    const t0 = performance.now();
    fitMeter({ answers: { days: 10 }, start: HYD, places: many, matrix: matrixFor(many) });
    expect(performance.now() - t0).toBeLessThan(300);
  });
  it("kinds of place get their typical visit time from the name first", () => {
    expect(categoryFor({ name: "Bogatha Waterfall", kind: "water" })).toBe("waterfall");
    expect(categoryFor({ name: "Ramappa Temple", kind: "sight" })).toBe("temple");
    expect(categoryFor({ name: "Golconda Fort", kind: "sight" })).toBe("fort");
    expect(categoryFor({ name: "Borra Caves", kind: "hill" })).toBe("museum");
    expect(categoryFor({ name: "Laknavaram", kind: "water" })).toBe("lake");
    expect(categoryFor({ name: "Munnar", kind: "town" })).toBe("other");
  });
});
