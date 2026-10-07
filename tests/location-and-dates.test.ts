import { describe, expect, it } from "vitest";
import { assessFix, zoomForAccuracy, STALE_MS } from "@/lib/location/quality";
import { checkStart } from "@/lib/location/start-check";
import { circlePolygon } from "@/lib/location/circle";
import { ageLabel, dayWithDate, relativeDay, tripTiming } from "@/lib/time-context";
import { describeDistance, summarizeDay, summarizeTrip } from "@/lib/trip-distance";
import { findFarPins } from "@/lib/pin-check";
import { localDateFor, parseTzOffset } from "@/lib/tz";

const NOW = 1_800_000_000_000;
const fix = (accuracyM: number | null, ageMs = 1000, lat = 17.385, lng = 78.486) => ({ lat, lng, accuracyM, fixAt: NOW - ageMs });

describe("GPS quality (Scenario J)", () => {
  it("grades by accuracy and never calls a rough position exact", () => {
    expect(assessFix(fix(20), NOW)).toMatchObject({ grade: "good", usable: true });
    expect(assessFix(fix(120), NOW)).toMatchObject({ grade: "fair", usable: true });
    const rough = assessFix(fix(600), NOW)!;
    expect(rough).toMatchObject({ grade: "rough", usable: false });
    expect(rough.message).toMatch(/rough/i);
    const ip = assessFix(fix(25_000), NOW)!;
    expect(ip).toMatchObject({ grade: "poor", usable: false });
    expect(ip.message).toMatch(/25 km/);
    expect(ip.message).toMatch(/network position/);
  });
  it("treats old readings, missing accuracy and nonsense as unusable", () => {
    expect(assessFix(fix(10, STALE_MS + 1), NOW)).toMatchObject({ grade: "stale", usable: false });
    expect(assessFix(fix(null), NOW)).toMatchObject({ grade: "unknown", usable: false });
    expect(assessFix({ lat: 99, lng: 0, accuracyM: 5, fixAt: NOW }, NOW)).toMatchObject({ grade: "unknown", usable: false });
    expect(assessFix(null, NOW)).toBeNull();
  });
  it("zooms out for rough positions instead of showing a street-level pin", () => {
    expect(zoomForAccuracy(20)).toBeGreaterThan(zoomForAccuracy(500));
    expect(zoomForAccuracy(500)).toBeGreaterThan(zoomForAccuracy(3000));
    expect(zoomForAccuracy(null)).toBeLessThanOrEqual(10);
  });
  it("draws a closed ring of the right size", () => {
    const ring = circlePolygon(78.5, 17.4, 1000).geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const dLat = Math.abs(ring[0][1] - 17.4) * 111_320;
    expect(dLat).toBeLessThan(1010); // radius ~1 km, not wildly off
  });
});

describe("planned date vs real date (Scenarios A, B)", () => {
  const trip = { start_date: "2026-10-07", num_days: 3 };
  it("knows today is before the trip and says so in words", () => {
    const t = tripTiming(trip, "2026-10-06");
    expect(t).toMatchObject({ state: "before", daysUntil: 1, todayDay: null });
    expect(t.headline).toMatch(/starts tomorrow/);
    expect(tripTiming(trip, "2026-10-08")).toMatchObject({ state: "during", todayDay: 2 });
    expect(tripTiming(trip, "2026-10-10").state).toBe("after");
    expect(tripTiming({ start_date: null, num_days: 2 }, "2026-10-06").state).toBe("no-dates");
  });
  it("labels dates relative to the traveller's today, with the real date", () => {
    expect(relativeDay("2026-10-07", "2026-10-06")).toBe("Tomorrow");
    expect(relativeDay("2026-10-06", "2026-10-06")).toBe("Today");
    expect(relativeDay("2026-10-05", "2026-10-06")).toBe("Yesterday");
    expect(relativeDay("2026-10-12", "2026-10-06")).toMatch(/12 Oct/);
    expect(dayWithDate("2026-10-07", "2026-10-06")).toMatch(/^Tomorrow · .*7 Oct/);
    expect(ageLabel(15 * 60_000)).toBe("15 min ago");
    expect(ageLabel(20_000)).toBe("just now");
  });
  it("uses the traveller's local date, not the server's UTC date", () => {
    const ms = Date.UTC(2026, 9, 6, 20, 0); // 20:00 UTC on 6 Oct = 01:30 on 7 Oct in India
    expect(localDateFor(ms, null)).toBe("2026-10-06");
    expect(localDateFor(ms, 330)).toBe("2026-10-07");
    expect(parseTzOffset("330")).toBe(330);
    expect(parseTzOffset("-480")).toBe(-480);
    expect(parseTzOffset("9999")).toBeNull();
    expect(parseTzOffset("abc")).toBeNull();
  });
});

describe("Drive Now checks (Scenarios B, C, D, J)", () => {
  const trip = { start_date: "2026-10-07", num_days: 3 };
  const hyd = { lat: 17.385, lng: 78.486, label: "Hyderabad" };
  const good = assessFix(fix(15), NOW)!;
  it("asks before an early start and never changes the plan", () => {
    const c = checkStart({ trip, todayISO: "2026-10-06", quality: good, here: hyd, plannedStart: hyd });
    expect(c.clear).toBe(false);
    expect(c.issues.map((i) => i.kind)).toEqual(["early"]);
    expect(c.issues[0]).toMatchObject({ plannedDate: "2026-10-07", daysUntil: 1 });
  });
  it("is clear when the date fits, you are at the start, and the position is precise", () => {
    expect(checkStart({ trip, todayISO: "2026-10-07", quality: good, here: hyd, plannedStart: hyd }).clear).toBe(true);
  });
  it("detects that you are somewhere else, only when the position is precise enough to prove it", () => {
    const vja = { lat: 16.506, lng: 80.648 };
    const sure = checkStart({ trip, todayISO: "2026-10-07", quality: good, here: vja, plannedStart: hyd });
    expect(sure.issues.map((i) => i.kind)).toEqual(["away-from-start"]);
    expect(sure.kmFromStart).toBeGreaterThan(200);
    const vague = assessFix(fix(25_000), NOW)!;
    const unsure = checkStart({ trip, todayISO: "2026-10-07", quality: vague, here: vja, plannedStart: hyd });
    expect(unsure.issues.map((i) => i.kind)).toEqual(["unsure-position"]); // not "you are in Vijayawada"
  });
  it("does not call you 'away' when the uncertainty is larger than the distance", () => {
    const near = { lat: 17.385 + 0.06, lng: 78.486 }; // ~6.7 km
    const q = assessFix(fix(140), NOW)!;
    expect(checkStart({ trip, todayISO: "2026-10-07", quality: q, here: near, plannedStart: hyd }).issues.map((i) => i.kind)).toEqual(["away-from-start"]);
  });
  it("reports an approximate position even without a planned start", () => {
    const c = checkStart({ trip, todayISO: "2026-10-07", quality: assessFix(fix(800), NOW), here: hyd, plannedStart: null });
    expect(c.issues.map((i) => i.kind)).toEqual(["unsure-position"]);
  });
});

describe("distance honesty (Scenario G)", () => {
  const hyd = { lat: 17.385, lng: 78.486 };
  const legs = [
    { lat: 16.506, lng: 80.648, drive_km: 275.4, drive_minutes: 285 },
    { lat: 17.687, lng: 83.218, drive_km: 350.2, drive_minutes: 390 },
  ];
  it("adds ROAD legs and reports the basis", () => {
    const s = summarizeDay(legs, hyd);
    expect(s).toMatchObject({ basis: "road", km: 625.6, minutes: 675, legs: 2 });
    expect(describeDistance(s)).toBe("626 km by road");
  });
  it("never presents a straight-line number as km driven", () => {
    const s = summarizeDay(legs.map((l) => ({ ...l, drive_km: null, drive_minutes: null })), hyd);
    expect(s.basis).toBe("straight");
    expect(s.minutes).toBeNull();
    expect(describeDistance(s)).toMatch(/straight-line/);
    expect(s.km).toBeLessThan(625); // straight-line is shorter than the road
  });
  it("labels mixed data as mixed", () => {
    const s = summarizeDay([legs[0], { ...legs[1], drive_km: null, drive_minutes: null }], hyd);
    expect(s.basis).toBe("partial");
    expect(describeDistance(s)).toMatch(/part road/);
  });
  it("chains days: each day starts where the previous ended, and the total is the sum", () => {
    const t = summarizeTrip([[legs[0]], [legs[1]]], hyd);
    expect(t).toMatchObject({ basis: "road", km: 625.6, minutes: 675, legs: 2 });
    expect(summarizeTrip([], hyd).basis).toBe("none");
    expect(summarizeDay([], hyd).basis).toBe("none");
  });
});

describe("far-pin check (screenshot bug: the return to the start city is not a wrong pin)", () => {
  const vizag = { lat: 17.687, lng: 83.218, label: "Visakhapatnam" };
  const places = [
    { id: "ok", lat: 17.7, lng: 83.3 },
    { id: "home", lat: 17.385, lng: 78.486 }, // Hyderabad, 513 km from Vizag
    { id: "wrong", lat: 19.07, lng: 72.87 }, // Mumbai
  ];
  it("still flags a genuinely wrong pin", () => {
    expect(Object.keys(findFarPins(places, vizag))).toEqual(["home", "wrong"]);
  });
  it("does not flag a stop that is the trip's own start city", () => {
    expect(Object.keys(findFarPins(places, vizag, undefined, [{ lat: 17.385, lng: 78.486 }]))).toEqual(["wrong"]);
  });
});

describe("a start point the traveller chose (no GPS)", () => {
  const hyd = { lat: 17.385, lng: 78.486, label: "Hyderabad" };
  const mothkur = { lat: 17.5, lng: 79.2 }; // roughly 75 km from Hyderabad: the user's real situation
  it("is treated as a precise start point, labelled as chosen, never as GPS", () => {
    const q = assessFix({ ...mothkur, accuracyM: null, fixAt: 0, manual: true }, NOW)!;
    expect(q).toMatchObject({ grade: "good", usable: true });
    expect(q.message).toMatch(/you chose/);
    expect(q.message).toMatch(/not a live GPS reading/);
  });
  it("so the app can tell you are ~70 km from the planned start and ask what to do", () => {
    const q = assessFix({ ...mothkur, accuracyM: null, fixAt: 0, manual: true }, NOW);
    const c = checkStart({ trip: { start_date: "2026-10-07", num_days: 3 }, todayISO: "2026-10-07", quality: q, here: mothkur, plannedStart: hyd });
    expect(c.issues.map((i) => i.kind)).toEqual(["away-from-start"]);
    expect(c.kmFromStart).toBeGreaterThan(60); expect(c.kmFromStart).toBeLessThan(90);
  });
  it("whereas a ±200 km network position cannot say whether you are at the start (your screenshot)", () => {
    const q = assessFix({ ...mothkur, accuracyM: 200_000, fixAt: NOW }, NOW);
    const c = checkStart({ trip: { start_date: "2026-10-07", num_days: 3 }, todayISO: "2026-10-07", quality: q, here: mothkur, plannedStart: hyd });
    expect(c.issues.map((i) => i.kind)).toEqual(["unsure-position"]);
  });
});

import { shouldPollForFix, POLL_AFTER_MS } from "@/lib/location/quality";
describe("laptops report only when their guess changes (your 'GPS signal lost' screenshot)", () => {
  const base = { nowMs: 1_000_000, manual: false };
  it("asks for a fresh reading itself when a network-grade device goes quiet", () => {
    expect(shouldPollForFix({ ...base, lastFixAtMs: base.nowMs - POLL_AFTER_MS - 1, accuracyM: 200_000 })).toBe(true);
    expect(shouldPollForFix({ ...base, lastFixAtMs: null, accuracyM: null })).toBe(true);        // nothing at all yet
  });
  it("does not poll while readings are flowing, for a real GPS, or for a place you chose", () => {
    expect(shouldPollForFix({ ...base, lastFixAtMs: base.nowMs - 3_000, accuracyM: 200_000 })).toBe(false);
    expect(shouldPollForFix({ ...base, lastFixAtMs: base.nowMs - 60_000, accuracyM: 8 })).toBe(false); // real GPS silent = real signal trouble: say so
    expect(shouldPollForFix({ ...base, lastFixAtMs: null, accuracyM: null, manual: true })).toBe(false);
  });
});
