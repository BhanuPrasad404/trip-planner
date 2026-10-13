import { describe, expect, it } from "vitest";
import { TERRAIN, analyzeProfile, profileStats, sampleAlong, toProfile, type ProfilePoint } from "@/lib/travel/terrain";

/** A profile from [km, elevation] pairs, one point per 1.5 km, linearly interpolated. */
const profile = (knots: [number, number][], step = 1.5): ProfilePoint[] => {
  const out: ProfilePoint[] = [];
  const end = knots[knots.length - 1][0];
  for (let km = 0; km <= end + 1e-9; km += step) {
    let i = 0;
    while (i < knots.length - 2 && knots[i + 1][0] < km) i++;
    const [k0, e0] = knots[i], [k1, e1] = knots[i + 1];
    out.push({ km: Math.round(km * 100) / 100, elevM: e0 + ((e1 - e0) * (km - k0)) / (k1 - k0) });
  }
  return out;
};

describe("analyzeProfile: sustained climbs and descents, from elevation only", () => {
  it("flat ground has no terrain segments", () => { expect(analyzeProfile(profile([[0, 540], [30, 545]]))).toEqual([]); });
  it("a real hill: 620 m over 21 km is one climb, with honest numbers", () => {
    const [s] = analyzeProfile(profile([[0, 300], [21, 920]]));
    expect(s).toMatchObject({ kind: "climb", steepness: "moderate" });
    expect(s.changeM).toBeGreaterThan(550); expect(s.lengthKm).toBeGreaterThan(18);
    expect(s.avgGradePct).toBeCloseTo(2.95, 0);
    expect(s.headline).toMatch(/^Climb of about \d+ m over \d+ km$/); expect(s.detail).toContain("above sea level");
  });
  it("a climb and then a descent are two separate segments, in order", () => {
    const segs = analyzeProfile(profile([[0, 300], [15, 900], [30, 350]]));
    expect(segs.map((s) => s.kind)).toEqual(["climb", "descent"]);
    expect(segs[0].endKm).toBeLessThanOrEqual(segs[1].startKm + 1.6);
  });
  it("small bumps and noise do not make a hill (acceptance: nothing inferred without evidence)", () => {
    expect(analyzeProfile(profile([[0, 500], [10, 580], [20, 520], [30, 590], [40, 510]]))).toEqual([]);
  });
  it("a short steep rise (150 m) and a long gentle one (200 m over 60 km) are not 'hill driving'", () => {
    expect(analyzeProfile(profile([[0, 400], [4, 550]]))).toEqual([]);
    expect(analyzeProfile(profile([[0, 400], [60, 600]]))).toEqual([]);
  });
  it("a small dip inside a long climb does not split it", () => {
    const segs = analyzeProfile(profile([[0, 300], [10, 600], [12, 560], [24, 900]]));
    expect(segs.filter((s) => s.kind === "climb")).toHaveLength(1);
  });
  it("steep means a high average slope", () => {
    const [s] = analyzeProfile(profile([[0, 200], [8, 700]]));
    expect(s.steepness).toBe("steep"); expect(s.avgGradePct).toBeGreaterThanOrEqual(TERRAIN.steepGradePct);
  });
  it("it never claims winding, dangerous, remote or any signal: only what elevation shows", () => {
    const text = JSON.stringify(analyzeProfile(profile([[0, 200], [8, 700]]))).toLowerCase();
    for (const claim of ["winding", "danger", "remote", "signal", "connectivity", "landslide", "hairpin"]) expect(text, claim).not.toContain(claim);
  });
  it("too few points: nothing", () => { expect(analyzeProfile([])).toEqual([]); expect(analyzeProfile([{ km: 0, elevM: 1 }, { km: 1, elevM: 2 }])).toEqual([]); });
  it("is deterministic and does not modify its input", () => {
    const p = profile([[0, 300], [21, 920]]);
    const copy = JSON.stringify(p);
    expect(analyzeProfile(p)).toEqual(analyzeProfile(p)); expect(JSON.stringify(p)).toBe(copy);
  });
});

describe("toProfile and stats", () => {
  it("smooths a single noisy sample and skips missing elevations instead of guessing", () => {
    const p = toProfile([{ km: 0, elevM: 100 }, { km: 1, elevM: 400 }, { km: 2, elevM: null }, { km: 3, elevM: 100 }]);
    expect(p.map((x) => x.km)).toEqual([0, 1, 3]);
    expect(p[1].elevM).toBeLessThan(400);
  });
  it("summarises the route's height", () => {
    const s = profileStats(profile([[0, 300], [15, 900], [30, 350]]))!;
    expect(s.maxM).toBeGreaterThan(850); expect(s.minM).toBeLessThan(350); expect(s.totalClimbM).toBeGreaterThan(550);
    expect(profileStats([])).toBeNull();
  });
});

describe("sampleAlong: asks the elevation service for a bounded number of points", () => {
  const line: [number, number][] = [[78, 17], [78.3, 17], [78.6, 17]]; // about 63 km east-west
  it("includes the start and end, with increasing distance", () => {
    const s = sampleAlong(line, 100);
    expect(s[0]).toMatchObject({ km: 0, lng: 78, lat: 17 });
    expect(s[s.length - 1].lng).toBeCloseTo(78.6, 3);
    expect(s.every((p, i) => i === 0 || p.km > s[i - 1].km)).toBe(true);
  });
  it("never more than the cap, and about one point per 1.5 km otherwise", () => {
    expect(sampleAlong(line, 20)).toHaveLength(20);
    const all = sampleAlong(line, 500);
    expect(all.length).toBeGreaterThan(35); expect(all.length).toBeLessThan(50);
  });
  it("a degenerate line yields nothing", () => {
    expect(sampleAlong([[78, 17]], 50)).toEqual([]); expect(sampleAlong([[78, 17], [78, 17]], 50)).toEqual([]); expect(sampleAlong(line, 1)).toEqual([]);
  });
});
