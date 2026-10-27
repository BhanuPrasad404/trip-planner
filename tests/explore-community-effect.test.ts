import { describe, expect, it } from "vitest";
import { ageText, communityLine, matchDestinations, sameName, summarize } from "@/lib/explore/community";
import { clock, planEffect } from "@/lib/explore/plan-effect";

const NOW = Date.parse("2026-10-27T06:00:00Z");
const day = 86_400_000;

describe("linking a place to the traveller feed", () => {
  const borra = { id: "way/1", name: "Borra Caves", lat: 18.2805, lng: 83.0378 };
  it("same name nearby → linked; another place 1 km away with a different name → not linked", () => {
    const m = matchDestinations([borra], [{ id: "d1", name: "Borra Guhalu Caves", lat: 18.285, lng: 83.04 }, { id: "d2", name: "Ananthagiri Coffee", lat: 18.29, lng: 83.04 }]);
    expect(m.get("way/1")?.id).toBe("d1");
    expect(matchDestinations([borra], [{ id: "d2", name: "Ananthagiri Coffee", lat: 18.289, lng: 83.04 }]).size).toBe(0);
  });
  it("anything within 400 m is the same spot, whatever its name; nothing beyond 2 km is linked even with the same name", () => {
    expect(matchDestinations([borra], [{ id: "d3", name: "Caves parking", lat: 18.2808, lng: 83.0381 }]).get("way/1")?.id).toBe("d3");
    expect(matchDestinations([borra], [{ id: "d4", name: "Borra Caves", lat: 18.31, lng: 83.04 }]).size).toBe(0);
  });
  it("generic words alone never make two names 'the same' (Temple ≠ Temple)", () => {
    expect(sameName("Sri Rama Temple", "Sri Venkateswara Temple")).toBe(false);
    expect(sameName("Golconda Fort", "Golkonda Fort")).toBe(false);   // spelled differently: only the 400 m rule can link these
    expect(sameName("Charminar", "Charminar, Hyderabad")).toBe(true);
  });
  it("counts posts, recent ones, and the latest moment; a back-dated photo counts from when it was TAKEN", () => {
    const c = summarize({ id: "d1", name: "Borra", lat: 0, lng: 0 }, [
      { destination_id: "d1", created_at: new Date(NOW - 2 * day).toISOString(), captured_at: null },
      { destination_id: "d1", created_at: new Date(NOW - 1 * day).toISOString(), captured_at: new Date(NOW - 90 * day).toISOString() },
      { destination_id: "dX", created_at: new Date(NOW).toISOString(), captured_at: null },
    ], NOW);
    expect(c).toMatchObject({ posts: 2, recent: 1 });
    expect(c.latestAt).toBe(new Date(NOW - 2 * day).toISOString());
  });
  it("an old report is said to be old, never 'current'", () => {
    const base = { destinationId: "d", name: "x", posts: 3, recent: 0 };
    expect(communityLine({ ...base, latestAt: new Date(NOW - 1 * day).toISOString() }, NOW)).toEqual({ text: "3 traveller reports · latest yesterday", fresh: "new" });
    expect(communityLine({ ...base, latestAt: new Date(NOW - 10 * day).toISOString() }, NOW).fresh).toBe("recent");
    const old = communityLine({ ...base, latestAt: new Date(NOW - 200 * day).toISOString() }, NOW);
    expect(old.fresh).toBe("old"); expect(old.text).toMatch(/may be out of date$/);
    expect(communityLine({ ...base, posts: 0, latestAt: null }, NOW)).toEqual({ text: "No traveller reports yet", fresh: "none" });
  });
  it("ages in plain words", () => { expect(ageText(0)).toBe("today"); expect(ageText(3 * day)).toBe("3 days ago"); expect(ageText(21 * day)).toBe("3 weeks ago"); expect(ageText(400 * day)).toBe("1 year ago"); });
});

describe("what adding a stop does to the day", () => {
  // Points: 0 = where the day starts, 1 = Stop A, 2 = Stop B, 3 = the candidate. The candidate sits between A and B.
  const M = [
    [0, 1800, 5400, 3000],
    [1800, 0, 3600, 1200],
    [5400, 3600, 0, 2700],
    [3000, 1200, 2700, 0],
  ];
  const stops = [{ id: "a", name: "Stop A", arrival_time: "09:30:00", opening_hours: null }, { id: "b", name: "Stop B", arrival_time: "15:00:00", opening_hours: "Mo-Su 09:00-15:30" }];
  it("puts it where it costs the least driving (between A and B), and says how much longer the day gets", () => {
    const e = planEffect({ stops, candidateName: "Cave", durations: M, basis: "road", visitMin: 60, dayISO: "2026-11-05", sunsetMin: 17 * 60 + 50 });
    expect(e).toMatchObject({ beforeId: "b", beforeName: "Stop B", afterName: "Stop A", addedDriveMin: 5, visitMin: 60, addedMin: 65 });   // (1200 + 2700 − 3600) s = 5 min
    expect(e.shifted).toEqual([{ id: "b", name: "Stop B", from: "3:00 PM", to: "4:05 PM" }]);
  });
  it("warns when a later stop's OWN listed hours say it would be closed at the new time", () => {
    const e = planEffect({ stops, candidateName: "Cave", durations: M, basis: "road", visitMin: 60, dayISO: "2026-11-05", sunsetMin: 18 * 60 });
    expect(e.warnings.join(" ")).toMatch(/Stop B may be closed when you'd get there \(about 4:05 PM\), by its listed opening hours/);
  });
  it("unknown hours are said to be unknown, never assumed open", () => {
    const e = planEffect({ stops: stops.map((s) => ({ ...s, opening_hours: null })), candidateName: "Cave", durations: M, basis: "road", visitMin: 60, dayISO: "2026-11-05", sunsetMin: null });
    expect(e.warnings).toHaveLength(0);
    expect(e.unknowns.join(" ")).toMatch(/Opening hours aren't known for 1 of the later stop/);
  });
  it("warns when the last stop slips past sunset (and not when it was already after sunset)", () => {
    const late = [{ id: "a", name: "Stop A", arrival_time: "09:30", opening_hours: null }, { id: "b", name: "Stop B", arrival_time: "17:30", opening_hours: "24/7" }];
    const e = planEffect({ stops: late, candidateName: "Cave", durations: M, basis: "road", visitMin: 60, dayISO: "2026-11-05", sunsetMin: 17 * 60 + 50 });
    expect(e.warnings.join(" ")).toMatch(/reach Stop B after sunset \(about 6:35 PM; sunset about 5:50 PM\)/);
    const already = planEffect({ stops: late.map((s) => ({ ...s, arrival_time: s.id === "b" ? "18:10" : s.arrival_time })), candidateName: "Cave", durations: M, basis: "road", visitMin: 60, dayISO: "2026-11-05", sunsetMin: 17 * 60 + 50 });
    expect(already.warnings.join(" ")).not.toMatch(/sunset/);
  });
  it("a far-out place goes at the END when that is cheapest; nothing is shifted then", () => {
    const far = [[0, 1800, 5400, 9000], [1800, 0, 3600, 9000], [5400, 3600, 0, 600], [9000, 9000, 600, 0]];
    const e = planEffect({ stops, candidateName: "Cave", durations: far, basis: "road", visitMin: 60, dayISO: "2026-11-05", sunsetMin: null });
    expect(e.beforeId).toBeNull(); expect(e.afterName).toBe("Stop B"); expect(e.shifted).toHaveLength(0); expect(e.addedDriveMin).toBe(10);
  });
  it("no dates / no planned times / estimated roads: each is said plainly, nothing is invented", () => {
    const e = planEffect({ stops: stops.map((s) => ({ ...s, arrival_time: null })), candidateName: "Cave", durations: M, basis: "estimate", visitMin: 45, dayISO: null, sunsetMin: null });
    expect(e.shifted).toHaveLength(0);
    expect(e.unknowns.join(" ")).toMatch(/no dates/);
    expect(e.unknowns.join(" ")).toMatch(/no planned times yet/);
    expect(e.unknowns.join(" ")).toMatch(/estimated from straight-line/);
  });
  it("an empty day: the new stop is simply the first", () => {
    const e = planEffect({ stops: [], candidateName: "Cave", durations: [[0, 1500], [1500, 0]], basis: "road", visitMin: 60, dayISO: "2026-11-05", sunsetMin: null });
    expect(e).toMatchObject({ beforeId: null, afterName: null, addedDriveMin: 25 });
  });
  it("clock text", () => { expect(clock(0)).toBe("12:00 AM"); expect(clock(13 * 60 + 5)).toBe("1:05 PM"); expect(clock(25 * 60)).toBe("1:00 AM"); });
});
