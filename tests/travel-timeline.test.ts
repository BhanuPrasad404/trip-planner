import { describe, expect, it } from "vitest";
import { buildTimeline, kmAlongLine } from "@/lib/travel/timeline";
import { checkDeparture, type FeasStop } from "@/lib/travel/feasibility";
import { localToUtcMs } from "@/lib/travel/clock";
import type { TerrainSegment } from "@/lib/travel/terrain";

// A 100 km east-west road at 17°N: one degree of longitude is about 106.45 km here.
const KM = 106.45;
const line: [number, number][] = Array.from({ length: 101 }, (_, i) => [78 + i / KM, 17] as [number, number]);
const at = (km: number) => ({ lat: 17, lng: 78 + km / KM });
const DEP = localToUtcMs("2026-10-14", "08:00", 330)!;
const stopsIn = [
  { id: "a", name: "Fort A", ...at(30), visitMin: 120 },
  { id: "b", name: "Lake B", ...at(90), visitMin: 60 },
];
const feas: FeasStop[] = [{ id: "a", name: "Fort A", driveMin: 60, visitMin: 120, hours: null, hoursSource: null }, { id: "b", name: "Lake B", driveMin: 60, visitMin: 60, hours: null, hoursSource: null }];
const climb: TerrainSegment = { kind: "climb", startKm: 60, endKm: 80, changeM: 400, lengthKm: 20, avgGradePct: 2, startElevM: 300, endElevM: 700, steepness: "moderate", headline: "Climb of about 400 m over 20 km", detail: "A gradual rise." };
const verdicts = checkDeparture({ departureMs: DEP, stops: feas }).verdicts;
const base = { departureMs: DEP, utcOffsetMin: 330, stops: stopsIn, verdicts };

describe("kmAlongLine", () => {
  it("finds how far along the road a point is", () => {
    expect(kmAlongLine(line, at(30))!).toBeCloseTo(30, 0); expect(kmAlongLine(line, at(90))!).toBeCloseTo(90, 0);
  });
  it("a point more than 5 km from the road is not 'on' it", () => {
    expect(kmAlongLine(line, { lat: 17.2, lng: 78.3 })).toBeNull();
  });
  it("a degenerate line gives nothing", () => { expect(kmAlongLine([[78, 17]], at(1))).toBeNull(); });
});

describe("buildTimeline: what lies ahead, in order", () => {
  it("starts with leaving, lists each stop at its arrival time, and ends with when you'd be done", () => {
    const t = buildTimeline(base);
    expect(t.map((i) => i.id)).toEqual(["depart", "stop:a", "stop:b", "end"]);
    expect(t[0]).toMatchObject({ atClock: "08:00", kind: "depart", basis: "plan" });
    expect(t[1].atClock).toBe("09:00"); expect(t[2].atClock).toBe("12:00"); // 11:00 after 2 h at the fort, + 60 min
    expect(t[3]).toMatchObject({ atClock: "13:00", approximate: true });
  });
  it("terrain is placed on the clock by interpolating along the road BETWEEN the stops, so time spent at a stop delays it", () => {
    const t = buildTimeline({ ...base, line, terrain: [climb] });
    const ter = t.find((i) => i.kind === "terrain")!;
    // leaves Fort A at 11:00 (km 30), reaches Lake B at 12:00 (km 90): km 60 is halfway → 11:30
    expect(ter.atClock).toBe("11:30"); expect(ter.approximate).toBe(true); expect(ter.basis).toBe("terrain-model");
    expect(ter.detail).toContain("Starts about 60 km from the start");
    const order = t.map((i) => i.id);
    expect(order.indexOf("terrain:climb:60")).toBeGreaterThan(order.indexOf("stop:a")); expect(order.indexOf("terrain:climb:60")).toBeLessThan(order.indexOf("stop:b"));
  });
  it("a steep segment is a warning, a moderate one is information", () => {
    expect(buildTimeline({ ...base, line, terrain: [{ ...climb, steepness: "steep" }] }).find((i) => i.kind === "terrain")!.tone).toBe("warn");
    expect(buildTimeline({ ...base, line, terrain: [climb] }).find((i) => i.kind === "terrain")!.tone).toBe("info");
  });
  it("terrain with no road line is NOT shown (we cannot say where it is)", () => {
    expect(buildTimeline({ ...base, line: null, terrain: [climb] }).some((i) => i.kind === "terrain")).toBe(false);
  });
  it("terrain beyond the last stop has no invented time: it says 'later' with its distance", () => {
    const late = buildTimeline({ ...base, line, terrain: [{ ...climb, startKm: 95, endKm: 99 }] }).find((i) => i.kind === "terrain")!;
    expect(late.atMs).toBeNull(); expect(late.detail).toContain("95 km");
  });
  it("a stop that is not on the road line cannot anchor terrain timing (nothing is guessed)", () => {
    const off = [{ ...stopsIn[0], lat: 17.3 }, stopsIn[1]];
    const t = buildTimeline({ ...base, stops: off, line, terrain: [climb] }).find((i) => i.kind === "terrain")!;
    expect(t.atClock).not.toBeNull(); // still timed by the stop that IS on the road, between depart and Lake B
    expect(t.atClock).not.toBe("11:30");
  });
  it("weather appears only when the forecast AT that stop's arrival time calls for it, at that time", () => {
    const asked: number[] = [];
    const rainAtArrival = (t: number) => { asked.push(t); return { title: "Heavy rain", detail: "About 9 mm in the hour. Carry rain gear. Open-Meteo forecast for 9:30 AM.", tone: "warn" as const }; };
    const t = buildTimeline({ ...base, weather: { a: rainAtArrival, b: () => null } });
    const w = t.filter((i) => i.kind === "weather");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ id: "weather:a", title: "Heavy rain at Fort A", basis: "forecast", tone: "warn", atClock: "09:00" });
    expect(asked).toEqual([t.find((i) => i.id === "stop:a")!.atMs]); // asked for exactly the arrival moment
  });
  it("hours we don't know show as information (never as a closure)", () => {
    expect(buildTimeline(base).find((i) => i.id === "stop:a")!).toMatchObject({ tone: "info", basis: "estimate" });
  });
  it("known hours that close before arrival show as a risk, and say they come from published hours", () => {
    const v = checkDeparture({ departureMs: localToUtcMs("2026-10-14", "21:00", 330)!, stops: [{ ...feas[0], hours: "Mo-Su 09:00-18:00", hoursSource: "user" }] }).verdicts;
    const t = buildTimeline({ ...base, departureMs: localToUtcMs("2026-10-14", "21:00", 330)!, stops: [stopsIn[0]], verdicts: v });
    expect(t.find((i) => i.id === "stop:a")).toMatchObject({ tone: "risk", basis: "published" });
  });
  it("a missing driving time leaves that stop (and what follows) without a time, last in the list, and no 'done' item", () => {
    const v = checkDeparture({ departureMs: DEP, stops: [{ ...feas[0], driveMin: null }, feas[1]] }).verdicts;
    const t = buildTimeline({ ...base, verdicts: v });
    expect(t.map((i) => i.id)).toEqual(["depart", "stop:a", "stop:b"]); expect(t[1].atMs).toBeNull(); expect(t[1].atClock).toBeNull();
  });
  it("is in time order, and 'after leaving' is measured from departure", () => {
    const t = buildTimeline({ ...base, line, terrain: [climb] });
    const times = t.map((i) => i.atMs).filter((x): x is number => x !== null);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(t.find((i) => i.id === "stop:b")!.afterMin).toBe(240);
  });
});
