// Explore that knows about the TRIP: what the traveller is doing now, the road that is left, and honest reasons.
import { describe, expect, it } from "vitest";
import { exploreContext } from "@/lib/explore/context";
import { buildExploreQuery, MAX_ROUTE_POINTS } from "@/lib/explore/query";
import { DETOUR_FIXED_MIN, detourText, estimateDetour, rankAlongRoute, rankAround } from "@/lib/explore/route-rank";
import { decimateLine } from "@/lib/explore/route-scope";
import { cacheKey, lineHash } from "@/lib/explore/service";
import type { ExploreItem } from "@/lib/explore/items";

const TODAY = "2026-10-27";
const trip = (over: Record<string, unknown> = {}) => ({ name: "Araku", start_date: "2026-11-05", num_days: 3, end_mode: "place" as const, start_city: "Hyderabad", start_lat: 17.385, start_lng: 78.487, dest_name: "Araku", dest_lat: 18.327, dest_lng: 82.877, ...over });
const stop = (id: string, name: string, lat: number, lng: number, day: number | null, seq: number, status: "planned" | "done" | "skipped" = "planned") => ({ id, name, lat, lng, day_number: day, sequence_order: seq, status });
const item = (id: string, name: string, lat: number, lng: number, over: Partial<ExploreItem> = {}): ExploreItem => ({ id, name, category: "fort", lat, lng, notable: false, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null, ...over });
const places = [stop("a", "Warangal Fort", 17.95, 79.617, 1, 1), stop("b", "Ramappa Temple", 18.259, 79.943, 1, 2), stop("c", "Araku Valley", 18.327, 82.877, 2, 1)];

describe("what is the traveller doing? (lib/explore/context.ts)", () => {
  it("no trip → plain search, no route claimed", () => {
    const c = exploreContext({ trip: null, places: [], todayISO: TODAY });
    expect(c.mode).toBe("none");
    expect(c.anchors).toHaveLength(0);
  });
  it("a finished or called-off trip is not an Explore context", () => {
    expect(exploreContext({ trip: trip({ closed_at: "2026-10-20T10:00:00Z" }), places, todayISO: TODAY }).mode).toBe("none");
  });
  it("planned (not started): the whole road, start → stops in order → end", () => {
    const c = exploreContext({ trip: trip(), places, todayISO: TODAY });
    expect(c.mode).toBe("planned");
    expect(c.anchors.map((a) => a.label)).toEqual(["Hyderabad", "Warangal Fort", "Ramappa Temple", "Araku Valley"]);   // the last stop IS the destination, so the end is not added twice
    expect(c.headline).toBe("Along your route to Araku");
  });
  it("the end is not repeated when the last stop IS the destination", () => {
    const c = exploreContext({ trip: trip(), places: [...places.slice(0, 2), stop("c", "Araku", 18.3271, 82.8771, 2, 1)], todayISO: TODAY });
    expect(c.anchors.map((a) => a.label)).toEqual(["Hyderabad", "Warangal Fort", "Ramappa Temple", "Araku"]);
  });
  it("active: only what is LEFT. Done and skipped stops are behind you", () => {
    const p = [stop("a", "Warangal Fort", 17.95, 79.617, 1, 1, "done"), stop("b", "Ramappa Temple", 18.259, 79.943, 1, 2, "skipped"), stop("c", "Araku Valley", 18.327, 82.877, 2, 1)];
    const c = exploreContext({ trip: trip({ start_date: "2026-10-26" }), places: p, todayISO: TODAY });
    expect(c.mode).toBe("active");
    expect(c.remaining.map((s) => s.label)).toEqual(["Araku Valley"]);
    expect(c.anchors[0].label).toBe("Warangal Fort");                       // no GPS: from the last FINISHED stop, and it says so
    expect(c.notes.join(" ")).toMatch(/position isn't shared/);
  });
  it("active with a shared position: the road starts where the traveller is, and no 'not shared' note", () => {
    const c = exploreContext({ trip: trip({ start_date: "2026-10-26" }), places, todayISO: TODAY, position: { lat: 17.7, lng: 79.0 } });
    expect(c.anchors[0]).toMatchObject({ lat: 17.7, lng: 79.0, label: "Where you are" });
    expect(c.notes.join(" ")).not.toMatch(/isn't shared/);
  });
  it("nothing left to do on the plan → staying: look round where you are", () => {
    const done = places.map((p) => ({ ...p, status: "done" as const }));
    const c = exploreContext({ trip: trip({ start_date: "2026-10-26" }), places: done, todayISO: TODAY, position: { lat: 18.33, lng: 82.88 } });
    expect(c.mode).toBe("staying");
    expect(c.focus).toMatchObject({ lat: 18.33, lng: 82.88 });
    expect(c.anchors).toHaveLength(0);
  });
  it("dates passed and not resumed: still the planned road, but it says these are for when you go", () => {
    const c = exploreContext({ trip: trip({ start_date: "2026-10-13", num_days: 2 }), places, todayISO: TODAY });
    expect(c.mode).toBe("planned");
    expect(c.notes.join(" ")).toMatch(/dates have passed/);
  });
  it("resumed after the dates passed counts as active", () => {
    expect(exploreContext({ trip: trip({ start_date: "2026-10-13", num_days: 2, resumed_at: "2026-10-27T05:00:00Z" }), places, todayISO: TODAY }).mode).toBe("active");
  });
  it("a trip with a start but no stops and no end has no road: it falls back to looking round the start, and says why", () => {
    const c = exploreContext({ trip: trip({ end_mode: "open", dest_lat: null, dest_lng: null, dest_name: null }), places: [], todayISO: TODAY });
    expect(c.anchors).toHaveLength(0);
    expect(c.focus?.label).toBe("Hyderabad");
    expect(c.notes.join(" ")).toMatch(/Add a start and a stop/);
  });
  it("bad coordinates are ignored, never turned into a place at 0,0", () => {
    const c = exploreContext({ trip: trip(), places: [stop("x", "Broken", NaN, 80, 1, 1), ...places], todayISO: TODAY });
    expect(c.remaining.map((s) => s.id)).not.toContain("x");
  });
});

describe("the map question for a road", () => {
  const line: [number, number][] = [[78.487, 17.385], [79.617, 17.95], [82.877, 18.327]];
  it("asks for everything within the corridor of the whole road: a list of coordinates, not a circle round the start", () => {
    const q = buildExploreQuery({ kind: "route", line, radius_km: 10 }, "fort");
    expect(q).toContain("(around:10000,17.3850,78.4870,17.9500,79.6170,18.3270,82.8770)");
  });
  it("a long road asks only for notable places when the category is heavy or 'all' (a 700 km road has thousands of shrines)", () => {
    expect(buildExploreQuery({ kind: "route", line, radius_km: 10 }, "temple")).not.toContain("(.all; - .n;)");
    expect(buildExploreQuery({ kind: "route", line: [[78.4, 17.3], [78.5, 17.4]], radius_km: 10 }, "temple")).toContain("(.all; - .n;)");   // a short hop gets everything
  });
  it("refuses a road that is too long, empty or has a bad point (nothing user-supplied is ever pasted into a query)", () => {
    expect(() => buildExploreQuery({ kind: "route", line: [[78, 17]], radius_km: 5 }, "fort")).toThrow();
    expect(() => buildExploreQuery({ kind: "route", line: Array.from({ length: MAX_ROUTE_POINTS + 1 }, (_, i) => [78 + i / 1000, 17] as [number, number]), radius_km: 5 }, "fort")).toThrow();
    expect(() => buildExploreQuery({ kind: "route", line: [[78, 17], [NaN, 17]], radius_km: 5 }, "fort")).toThrow();
  });
  it("the corridor radius is clamped (1–25 km)", () => {
    expect(buildExploreQuery({ kind: "route", line, radius_km: 500 }, "fort")).toContain("around:25000");
    expect(buildExploreQuery({ kind: "route", line, radius_km: 0 }, "fort")).toContain("around:1000");
  });
  it("shrinks a dense road to the limit and keeps both ends", () => {
    const dense = Array.from({ length: 5000 }, (_, i) => [78 + i / 1000, 17 + i / 2000] as [number, number]);
    const d = decimateLine(dense);
    expect(d).toHaveLength(MAX_ROUTE_POINTS);
    expect(d[0]).toEqual(dense[0]); expect(d[d.length - 1]).toEqual(dense[dense.length - 1]);
    expect(decimateLine(line)).toEqual(line);
  });
  it("two travellers on the same road share one saved answer; a different road or width does not; the key fits the table (80)", () => {
    const k = (l: [number, number][], r = 10) => cacheKey({ kind: "route", line: l, radius_km: r }, "fort");
    expect(k(line)).toBe(k(line.map(([a, b]) => [a + 0.0001, b] as [number, number])));   // 10 m apart: same road
    expect(k(line)).not.toBe(k([[78.487, 17.385], [79.617, 17.95], [83.5, 18.9]]));
    expect(k(line)).not.toBe(k(line, 20));
    expect(k(line).length).toBeLessThanOrEqual(80);
    expect(lineHash(line)).toBe(lineHash(line));
  });
});

describe("ranking along a road: honest numbers, honest reasons", () => {
  const road: [number, number][] = [[78.0, 17.0], [79.0, 17.0], [80.0, 17.0]];            // a straight road due east, about 106 km per degree of longitude
  const ctx = exploreContext({ trip: trip({ start_lat: 17.0, start_lng: 78.0, dest_lat: 17.0, dest_lng: 80.0 }), places: [stop("s", "Midway Town", 17.0, 79.0, 1, 1)], todayISO: TODAY });
  it("a place on the road is 'On your route'; one 5 km off gets a labelled ESTIMATE of the extra drive", () => {
    const [on, off] = rankAlongRoute([item("n1", "On Road Fort", 17.0, 78.5), item("n2", "Off Road Fort", 17.045, 78.5)], road, ctx, { maxOffKm: 10, limit: 10 }).sort((a, b) => a.offKm - b.offKm);
    expect(on.reasons[0]).toBe("On your route");
    expect(off.offKm).toBeGreaterThan(4.5); expect(off.offKm).toBeLessThan(5.5);
    expect(off.detour).toMatchObject({ basis: "estimate" });
    expect(off.detour!.min).toBe(Math.round((off.offKm * 2) / 35 * 60 + DETOUR_FIXED_MIN));
    expect(off.reasons[0]).toMatch(/^About \d+ min extra drive \(\d+(\.\d)? km there and back, estimated\)$/);
  });
  it("anything farther than the corridor is dropped, not shown with a big number", () => {
    expect(rankAlongRoute([item("far", "Far Fort", 17.2, 78.5)], road, ctx, { maxOffKm: 10 })).toHaveLength(0);
  });
  it("a road-measured detour is labelled 'by road', not 'estimated'", () => {
    expect(detourText({ km: 6, min: 14, basis: "road" }, 3)).toBe("About 14 min extra drive (6 km there and back, by road)");
    expect(detourText(estimateDetour(0.4), 0.4)).toBe("On your route");
  });
  it("'near your next stop' only when it is really within 12 km of a remaining stop", () => {
    const [a] = rankAlongRoute([item("n", "Close Cave", 17.0, 79.05)], road, ctx, { maxOffKm: 10 });
    expect(a.nearStop).toMatchObject({ name: "Midway Town", isNext: true });
    expect(a.reasons.join(" ")).toMatch(/from your next stop, Midway Town/);
    const [b] = rankAlongRoute([item("m", "Distant Cave", 17.0, 78.3)], road, ctx, { maxOffKm: 10 });
    expect(b.nearStop).toBeNull();
    expect(b.reasons.join(" ")).not.toMatch(/stop/);
  });
  it("notable and heritage claims come only from the map's own tags; nothing is said about interests, crowds or opening", () => {
    const [x] = rankAlongRoute([item("h", "Old Fort", 17.0, 78.5, { notable: true, heritage: true })], road, ctx, { maxOffKm: 10 });
    expect(x.reasons.join(" ")).toMatch(/heritage site on OpenStreetMap/);
    const [y] = rankAlongRoute([item("p", "Plain Fort", 17.0, 78.5)], road, ctx, { maxOffKm: 10 });
    expect(y.reasons.join(" ")).not.toMatch(/Wikipedia|heritage|popular|crowd|open|you'll love|interest/i);
  });
  it("well known and close beats well known and a detour beats an unknown on the road; but a famous place 30 min away does not bury a fine one on the road", () => {
    const ranked = rankAlongRoute([
      item("a", "Famous On Road", 17.0, 78.4, { notable: true }),
      item("b", "Unknown On Road", 17.0, 78.6),
      item("c", "Famous Detour", 17.06, 78.5, { notable: true }),
    ], road, ctx, { maxOffKm: 10, limit: 10 });
    expect(ranked[0].id).toBe("a");
    expect(ranked.map((r) => r.id)).toContain("c");
  });
  it("no single category fills the screen: a cap of half the page, the rest after", () => {
    const many = [...Array.from({ length: 8 }, (_, i) => item(`t${i}`, `Temple ${i}`, 17.0, 78.2 + i / 20, { category: "temple", notable: true })), item("w", "Waterfall", 17.0, 79.5, { category: "waterfall" })];
    const top = rankAlongRoute(many, road, ctx, { maxOffKm: 10, limit: 6 }).map((i) => i.category);
    expect(top.slice(0, 4).filter((c) => c === "temple")).toHaveLength(3);       // the cap: half the page
    expect(top.slice(0, 4)).toContain("waterfall");                                // the other kind comes before the 4th temple
    expect(top).toHaveLength(9);                                                   // and nothing is lost: the extra temples follow
  });
  it("active trip: places already behind the traveller are dropped", () => {
    const active = exploreContext({ trip: trip({ start_date: "2026-10-26" }), places: [stop("s", "Midway Town", 17.0, 79.0, 1, 1)], todayISO: TODAY, position: { lat: 17.0, lng: 78.8 } });
    const r = rankAlongRoute([item("behind", "Behind Fort", 17.0, 78.3), item("ahead", "Ahead Fort", 17.0, 79.6)], [[78.8, 17.0], [79.0, 17.0], [80.0, 17.0]], active, { maxOffKm: 10 });
    expect(r.map((i) => i.id)).toEqual(["ahead"]);
    expect(r[0].aheadKm).toBeGreaterThan(70);
  });
});

describe("staying somewhere: round the spot, no route claimed", () => {
  const focus = { lat: 18.327, lng: 82.877, label: "Araku" };
  it("distance from where you are, nothing about a detour", () => {
    const [x] = rankAround([item("v", "Borra Caves", 18.28, 82.88)], focus, { maxOffKm: 30 });
    expect(x.detour).toBeNull(); expect(x.aheadKm).toBeNull();
    expect(x.reasons[0]).toMatch(/^\d+(\.\d)? km from Araku$/);
  });
  it("anything beyond the radius is dropped", () => {
    expect(rankAround([item("far", "Far", 17.0, 80.0)], focus, { maxOffKm: 30 })).toHaveLength(0);
  });
});
