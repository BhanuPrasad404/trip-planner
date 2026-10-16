// Task 10: the km left is measured from where I REALLY am, to the next stop and then only between the stops that remain.
// A fake routing service measures each leg from the points it is given (straight line × 1.25), so no distance is hard-coded:
// every expectation is computed from the same coordinates. Places are spread over India to get tiny and very long distances.
import { describe, expect, it } from "vitest";
import { distanceKm } from "@/lib/geo";
import { assessFix } from "@/lib/location/quality";
import { kmText, remainingDistance, type RemainingInput, type RemainingTarget } from "@/lib/trip/remaining";

type P = { lat: number; lng: number };
const ROAD = 1.25;
const legOf = (a: P, b: P) => ({ km: Math.round(distanceKm(a, b) * ROAD * 10) / 10, minutes: Math.round(distanceKm(a, b) * ROAD * 1.2) });
type T = RemainingTarget & P;
const t = (id: string, name: string, lat: number, lng: number): T => ({ id, name, lat, lng });

const HYDERABAD = { lat: 17.385, lng: 78.4867 };          // the trip's planned START (must never be used)
const VIJAYAWADA = { lat: 16.5062, lng: 80.648 };          // where I really am: far from the start
const KONDAPALLI = t("k", "Kondapalli Fort", 16.6195, 80.5413);
const AMARAVATI = t("a", "Amaravati", 16.5131, 80.5165);
const UNDAVALLI = t("u", "Undavalli Caves", 16.4963, 80.5808);
const KOLLERU = t("l", "Kolleru Lake", 16.65, 81.2);
const KANYAKUMARI = t("ky", "Kanyakumari", 8.0883, 77.5385);

const NOW = 1_800_000_000_000;
const gps = (p: P, accuracyM = 8, ageMs = 1_000) => ({ lat: p.lat, lng: p.lng, accuracyM, fixAt: NOW - ageMs });
/** What the routing service answers for [me, ...targets] (the request /api/eta receives). */
const routeFor = (me: P, targets: T[], source: "osrm" | "estimate" = "osrm") => ({
  stopIds: targets.map((x) => x.id),
  legs: targets.map((x, i) => legOf(i === 0 ? me : targets[i - 1], x)),
  source, at: NOW,
});
const input = (o: Partial<RemainingInput> & { me: ReturnType<typeof gps>; targets: T[] }): RemainingInput => {
  const fix = { ...o.me, at: NOW, heading: null, speedKmh: null };
  return { route: routeFor(o.me, o.targets), nav: null, quality: assessFix(fix, NOW), nowMs: NOW, ...o };
};
const sum = (pts: P[]) => Math.round(pts.slice(1).reduce((a, p, i) => a + legOf(pts[i], p).km, 0) * 10) / 10;
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.051);

describe("measured from my real position, never the trip's start", () => {
  it("me far from the start point: next = my position → stop 1, total = that + legs between remaining stops", () => {
    const me = gps(VIJAYAWADA);
    const r = remainingDistance(input({ me, targets: [KONDAPALLI, AMARAVATI, UNDAVALLI] }))!;
    near(r.next.km, legOf(VIJAYAWADA, KONDAPALLI).km);
    near(r.totalKm, sum([VIJAYAWADA, KONDAPALLI, AMARAVATI, UNDAVALLI]));
    // The start point (Hyderabad, ~270 km away) is nowhere in these numbers.
    expect(r.totalKm).toBeLessThan(sum([HYDERABAD, KONDAPALLI, AMARAVATI, UNDAVALLI]) - 100);
    expect(r.exact).toBe(true);
    expect(r.basis).toBe("road");
  });

  it("while navigating, the next-stop km is the LIVE road distance from my position (not the leg measured a while ago)", () => {
    const measuredAt = gps(VIJAYAWADA);
    const route = routeFor(measuredAt, [KONDAPALLI, AMARAVATI]);
    // I have driven on since the ETA was measured: navigation says 6.3 km of road are left to Kondapalli.
    const liveLeftM = (legOf(VIJAYAWADA, KONDAPALLI).km - 2.4) * 1000;
    const r = remainingDistance({ ...input({ me: measuredAt, targets: [KONDAPALLI, AMARAVATI] }), route, nav: { targetId: "k", remainingM: liveLeftM, remainingS: 600 } })!;
    near(r.next.km, liveLeftM / 1000);
    near(r.totalKm, liveLeftM / 1000 + legOf(KONDAPALLI, AMARAVATI).km);
    expect(r.legs[0].km).toBeCloseTo(liveLeftM / 1000, 1); // the per-stop list (DrivePanel) uses the same first leg
  });

  it("standing ON a stop: a few metres, shown in metres, never '0.0 km'", () => {
    const onIt = { lat: KONDAPALLI.lat + 0.00018, lng: KONDAPALLI.lng }; // ~20 m
    const r = remainingDistance(input({ me: gps(onIt), targets: [KONDAPALLI, AMARAVATI] }))!;
    expect(r.next.km).toBeLessThan(0.05);
    expect(kmText(r.next.km, r)).toMatch(/^\d+ m$/);
    near(r.totalKm, sum([onIt, KONDAPALLI, AMARAVATI]));
  });

  it("very long drive (across India): whole km with Indian digit grouping", () => {
    const r = remainingDistance(input({ me: gps(HYDERABAD), targets: [KANYAKUMARI] }))!;
    expect(r.totalKm).toBeGreaterThan(1000);
    expect(kmText(r.totalKm, r)).toBe(`${Math.round(r.totalKm).toLocaleString("en-IN")} km`);
    expect(kmText(r.totalKm, r)).toContain(",");
  });
});

describe("deleted stops never count (first, middle, last)", () => {
  const all = [KONDAPALLI, AMARAVATI, UNDAVALLI, KOLLERU];
  const me = gps(VIJAYAWADA);
  const full = remainingDistance(input({ me, targets: all }))!;
  const after = (left: T[]) => remainingDistance(input({ me, targets: left }))!;

  it("delete the FIRST stop: total = me → stop 2 → … (the leg to the deleted stop is gone)", () => {
    const r = after(all.slice(1));
    near(r.totalKm, sum([VIJAYAWADA, AMARAVATI, UNDAVALLI, KOLLERU]));
    expect(r.next.id).toBe("a");
  });
  it("delete a MIDDLE stop: total drops by exactly its two legs, plus the new direct leg", () => {
    const r = after([KONDAPALLI, UNDAVALLI, KOLLERU]);
    const dropped = legOf(KONDAPALLI, AMARAVATI).km + legOf(AMARAVATI, UNDAVALLI).km - legOf(KONDAPALLI, UNDAVALLI).km;
    near(r.totalKm, full.totalKm - dropped);
  });
  it("delete the LAST stop: total ends at the stop before it", () => {
    const r = after(all.slice(0, 3));
    near(r.totalKm, sum([VIJAYAWADA, KONDAPALLI, AMARAVATI, UNDAVALLI]));
    expect(r.lastName).toBe("Undavalli Caves");
  });
  it("the OLD route (measured before the delete) is never used with the new list — no number instead of a wrong one", () => {
    const old = routeFor(me, all);
    for (const left of [all.slice(1), [KONDAPALLI, UNDAVALLI, KOLLERU], all.slice(0, 3)]) {
      expect(remainingDistance({ ...input({ me, targets: left }), route: old })).toBeNull();
    }
  });
});

describe("honest when the numbers are not exact", () => {
  const targets = [KONDAPALLI, AMARAVATI];
  it("weak GPS (±400 m): no exact number, says why", () => {
    const r = remainingDistance(input({ me: gps(VIJAYAWADA, 400), targets }))!;
    expect(r.exact).toBe(false);
    expect(r.gps).toBe("weak");
    expect(kmText(r.totalKm, r)).toMatch(/^about \d/);
    expect(r.note).toMatch(/GPS is weak/i);
  });
  it("old GPS (no reading for 3 minutes): approximate, says how old", () => {
    const r = remainingDistance(input({ me: gps(VIJAYAWADA, 8, 180_000), targets }))!;
    expect(r.gps).toBe("old");
    expect(r.exact).toBe(false);
    expect(r.note).toMatch(/3 min old/);
  });
  it("routing failed (straight-line estimate): labelled 'estimated' everywhere it is shown", () => {
    const me = gps(VIJAYAWADA);
    const r = remainingDistance({ ...input({ me, targets }), route: routeFor(me, targets, "estimate") })!;
    expect(r.basis).toBe("estimated");
    expect(r.exact).toBe(false);
    expect(kmText(r.next.km, r)).toMatch(/estimated/);
    expect(r.note).toMatch(/estimated/i);
  });
  it("…and back to exact road km as soon as routing answers again", () => {
    const r = remainingDistance(input({ me: gps(VIJAYAWADA), targets }))!;
    expect(r.basis).toBe("road");
    expect(kmText(r.next.km, r)).not.toMatch(/about|estimated/);
  });
  it("a place I chose (no GPS) is said to be the starting point of the numbers", () => {
    const me = { ...gps(HYDERABAD), manual: true };
    const r = remainingDistance(input({ me, targets }))!;
    expect(r.gps).toBe("chosen");
    expect(r.note).toMatch(/place you chose/i);
  });
  it("no position at all: no number", () => {
    expect(remainingDistance({ ...input({ me: gps(VIJAYAWADA), targets }), me: null })).toBeNull();
  });
});

describe("more stops than the route covers", () => {
  it("12 stops, route measured for the first 8: the total says it reaches stop 8, not the last stop", () => {
    const many = Array.from({ length: 12 }, (_, i) => t(`s${i}`, `Stop ${i + 1}`, 16.5 + i * 0.05, 80.6 + i * 0.03));
    const me = gps(VIJAYAWADA);
    const r = remainingDistance({ ...input({ me, targets: many }), route: routeFor(me, many.slice(0, 8)) })!;
    expect(r.covers).toBe(8);
    expect(r.coversAll).toBe(false);
    expect(r.lastName).toBe("Stop 8");
    near(r.totalKm, sum([VIJAYAWADA, ...many.slice(0, 8)]));
  });
});
