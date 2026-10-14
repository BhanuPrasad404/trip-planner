import { describe, expect, it } from "vitest";
import { analyzeProfile, type ProfilePoint, type TerrainSegment } from "@/lib/travel/terrain";
import { HILL_LINK_KM, hillStationLinks, implications, linkSentence, NOT_ASSESSED, routeCharacter, type HillStop } from "@/lib/travel/hills";

const ramp = (fromKm: number, toKm: number, fromM: number, toM: number, n = 20): ProfilePoint[] => Array.from({ length: n }, (_, i) => ({ km: fromKm + ((toKm - fromKm) * i) / (n - 1), elevM: fromM + ((toM - fromM) * i) / (n - 1) }));
const flat = (km0: number, km1: number, m: number) => ramp(km0, km1, m, m, 6);
const seg = (p: ProfilePoint[]) => analyzeProfile(p);

describe("route character is decided from real climbs, in plain words", () => {
  it("a flat plateau road is flat, even at height (height alone is not a hill)", () => {
    const c = routeCharacter(seg(flat(0, 80, 900)), { minM: 895, maxM: 905, totalClimbM: 20, totalDescentM: 20 });
    expect(c.kind).toBe("flat"); expect(c.detail).toContain("no long climbs");
  });
  it("small ups and downs with no sustained hill are 'rolling'", () => {
    const c = routeCharacter([], { minM: 100, maxM: 260, totalClimbM: 420, totalDescentM: 400 });
    expect(c.kind).toBe("rolling");
  });
  it("one long climb is hilly and says how big", () => {
    const s = seg([...flat(0, 20, 100), ...ramp(20, 40, 100, 500), ...flat(40, 70, 500)]);
    const c = routeCharacter(s, null);
    expect(s.filter((x) => x.kind === "climb")).toHaveLength(1);
    expect(c.kind).toBe("hilly"); expect(c.headline).toBe("One long climb on this route"); expect(c.detail).toMatch(/about 400 m over 20 km/);
  });
  it("a climb of 600 m or more is a mountain climb and names the height reached", () => {
    const s = seg([...flat(0, 20, 300), ...ramp(20, 60, 300, 1100), ...flat(60, 70, 1100)]);
    const c = routeCharacter(s, null);
    expect(c.kind).toBe("mountain"); expect(c.detail).toContain("1100 m above sea level");
  });
  it("no data at all is not called anything but flat-with-no-climbs: never a hazard", () => {
    expect(routeCharacter([], null).kind).toBe("flat");
  });
});

describe("a climb is tied to a hill station only when the stop says so AND sits on the road near the top", () => {
  const climb = seg([...flat(0, 20, 300), ...ramp(20, 60, 300, 1100), ...flat(60, 70, 1100)]);
  const stop = (o: Partial<HillStop>): HillStop => ({ id: "s", name: "Araku Valley", category: "hill_station", kmAlong: 62, ...o });
  it("links Araku-style: category hill_station, on the line near the top", () => {
    const l = hillStationLinks(climb, [stop({})]);
    expect(l).toHaveLength(1); expect(linkSentence(l[0])).toContain("leads up to Araku Valley, a hill station on your trip");
  });
  it("a high climb to a place that is not a hill station is NOT called a hill station", () => {
    expect(hillStationLinks(climb, [stop({ category: "viewpoint", name: "Windy Point" })])).toHaveLength(0);
  });
  it("a hill station that is not on the road line (null) is never linked", () => {
    expect(hillStationLinks(climb, [stop({ kmAlong: null })])).toHaveLength(0);
  });
  it("a hill station far past the climb's top is not linked", () => {
    expect(hillStationLinks(climb, [stop({ kmAlong: 60 + HILL_LINK_KM + 5 })])).toHaveLength(0);
  });
  it("a hill station before the climb starts is not linked", () => {
    expect(hillStationLinks(climb, [stop({ kmAlong: 5 })])).toHaveLength(0);
  });
  it("descents are never linked", () => {
    const down: TerrainSegment[] = seg([...flat(0, 5, 1100), ...ramp(5, 45, 1100, 300), ...flat(45, 60, 300)]);
    expect(down.every((d) => d.kind === "descent")).toBe(true);
    expect(hillStationLinks(down, [stop({ kmAlong: 46 })])).toHaveLength(0);
  });
});

describe("implications are only said when the evidence supports them, and what we do not know is always said", () => {
  it("no hill sections: no driving advice at all", () => { expect(implications([])).toEqual([]); });
  it("a moderate climb: the time-estimate caveat only", () => {
    const m = seg([...flat(0, 5, 100), ...ramp(5, 20, 100, 450), ...flat(20, 50, 450)]);
    const t = implications(m);
    expect(m[0].steepness).toBe("moderate"); expect(t).toHaveLength(1); expect(t[0]).toMatch(/estimated from the type of road, not its slope/);
  });
  it("a steep climb adds the vehicle note; a steep descent adds the braking note", () => {
    const s = seg([...flat(0, 5, 100), ...ramp(5, 25, 100, 900), ...flat(25, 30, 900), ...ramp(30, 45, 900, 200), ...flat(45, 60, 200)]);
    const t = implications(s).join(" ");
    expect(t).toMatch(/steep/); expect(t).toMatch(/braking/);
  });
  it("it never claims bends or road condition, and says so", () => {
    expect(NOT_ASSESSED).toMatch(/bends/); expect(NOT_ASSESSED).toMatch(/road surface/); expect(NOT_ASSESSED).toMatch(/don't measure/);
    for (const text of [...implications(seg(ramp(0, 40, 100, 900))), linkSentence({ segment: seg(ramp(0, 40, 100, 900))[0], stop: { id: "s", name: "X", category: "hill_station", kmAlong: 40 } })]) expect(text).not.toMatch(/hairpin|winding|dangerous|landslide/i);
  });
});

describe("regression: flat road before a hill must not hide it or stretch it", () => {
  it("20 km of plain then a 400 m climb is found, starting where the climb really starts", () => {
    const s = seg([...flat(0, 20, 100), ...ramp(20, 40, 100, 500), ...flat(40, 90, 500)]);
    expect(s).toHaveLength(1);
    expect(s[0].startKm).toBeGreaterThanOrEqual(19); expect(s[0].startKm).toBeLessThanOrEqual(21);
    expect(s[0].lengthKm).toBeLessThanOrEqual(22);
    expect(s[0].avgGradePct).toBeGreaterThanOrEqual(1.8);
  });
  it("a plateau after the top does not lengthen the climb", () => {
    const s = seg([...ramp(0, 20, 100, 500), ...flat(20, 120, 500)]);
    expect(s[0].endKm).toBeLessThanOrEqual(21);
  });
});
