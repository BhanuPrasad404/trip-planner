import { describe, expect, it } from "vitest";
import { ageText, buildPulse, type PulseReport } from "@/lib/intel/pulse";
import { computeHealth } from "@/lib/intel/health";
import { learnFromTrips, tripReality, type LearnPlace, type LearnTrip } from "@/lib/learning";

// Saturday 10 Oct 2026, 14:00 India time
const NOW = Date.UTC(2026, 9, 10, 8, 30);
const OFFSET = 330;
const ago = (mins: number) => new Date(NOW - mins * 60_000).toISOString();
const rep = (user: string, tags: string[], mins: number, extra: Partial<PulseReport> = {}): PulseReport => ({ user_id: user, tags, note: null, photo_path: null, created_at: ago(mins), ...extra });
const pulse = (reports: PulseReport[], over: Partial<Parameters<typeof buildPulse>[0]> = {}) =>
  buildPulse({ hours: null, hoursCheckedAt: null, weather: null, reports, photoUrl: (p) => `https://sb/${p}`, nowMs: NOW, utcOffsetMin: OFFSET, ...over });

describe("ageText", () => {
  it("speaks in human units", () => {
    expect(ageText(NOW, ago(1))).toBe("just now");
    expect(ageText(NOW, ago(24))).toBe("24 min ago");
    expect(ageText(NOW, ago(180))).toBe("3 h ago");
    expect(ageText(NOW, ago(60 * 24 * 3))).toBe("3 days ago");
    expect(ageText(NOW, ago(60 * 24 * 21))).toBe("3 weeks ago");
  });
});

describe("Live Place Pulse", () => {
  it("never invents anything: with no data it lists what is unknown", () => {
    const p = pulse([]);
    expect(p.signals).toEqual([]);
    expect(p.gaps.join(" ")).toMatch(/opening hours are not available/i);
    expect(p.gaps.join(" ")).toMatch(/Live weather is unavailable/);
    expect(p.gaps.join(" ")).toMatch(/Live crowd information is unavailable/);
    expect(p.gaps.join(" ")).toMatch(/Parking details are unavailable/);
    expect(p.photos).toEqual([]);
  });

  it("labels opening hours as map data (not official) with their age, and reads them correctly", () => {
    const p = pulse([], { hours: "Mo-Su 09:00-18:00", hoursCheckedAt: ago(60 * 24 * 12) });
    const s = p.signals.find((x) => x.id === "hours")!;
    expect(s).toMatchObject({ source: "map-data", trust: "medium", value: "Open until 18:00" });
    expect(s.ageText).toMatch(/12 days ago/);
    expect(s.detail).toMatch(/not an official listing/);
  });

  it("separates RECENT reports (last 6 h) from COMMUNITY (last 7 days), and counts distinct travelers", () => {
    const p = pulse([rep("a", ["crowded"], 24), rep("b", ["crowded"], 90), rep("a", ["crowded"], 100), rep("c", ["road_bad"], 60 * 48), rep("d", ["road_bad"], 60 * 72)]);
    const crowd = p.signals.find((x) => x.id === "recent-crowded")!;
    expect(crowd).toMatchObject({ source: "recent", trust: "high" });
    expect(crowd.value).toMatch(/^2 travelers/); // a and b — not 3 reports
    expect(crowd.ageText).toBe("24 min ago");
    const road = p.signals.find((x) => x.id === "community-road_bad")!;
    expect(road.source).toBe("community");
    expect(road.value).toMatch(/2 travelers .* last 7 days/);
  });

  it("surfaces the conflict between map data and traveler reports instead of picking a side", () => {
    const p = pulse([rep("a", ["closed"], 18), rep("b", ["closed"], 30)], { hours: "24/7", hoursCheckedAt: ago(60 * 24) });
    expect(p.conflicts[0]).toMatchObject({ title: "Information conflict" });
    expect(p.conflicts[0].detail).toMatch(/Map data says open, but 2 travelers reported it closed 18 min ago/);
  });

  it("one report is not enough to claim a conflict, and 'closed' isn't a conflict when the map also says closed", () => {
    expect(pulse([rep("a", ["closed"], 18)], { hours: "24/7" }).conflicts).toEqual([]);
    expect(pulse([rep("a", ["closed"], 18), rep("b", ["closed"], 20)], { hours: "Mo-Su 00:00-01:00" }).conflicts).toEqual([]);
  });

  it("shows when travelers disagree with each other", () => {
    const p = pulse([rep("a", ["water_flowing"], 60 * 5), rep("b", ["dry"], 60 * 9)]);
    expect(p.conflicts.map((c) => c.id)).toContain("water_flowing-vs-dry");
  });

  it("only calls something a typical pattern with enough reports over enough days, and labels it historical", () => {
    const few = pulse([rep("a", ["crowded"], 60 * 30), rep("b", ["crowded"], 60 * 60)]);
    expect(few.signals.some((s) => s.source === "historical")).toBe(false);
    expect(few.gaps.join(" ")).toMatch(/not enough past reports/);
    const many = pulse([1, 2, 3, 4, 5, 6].map((d) => rep(`u${d}`, [d === 6 ? "quiet" : "crowded"], 60 * 24 * d + 600)));
    const h = many.signals.find((s) => s.source === "historical")!;
    expect(h).toMatchObject({ trust: "low", value: "Usually crowded (5 of 6 reports)" });
    expect(h.detail).toMatch(/not live information/);
  });

  it("shows real photos only, newest first, with their age", () => {
    const p = pulse([rep("a", ["great_view"], 600, { photo_path: "a/old.jpg" }), rep("b", [], 20, { photo_path: "b/new.jpg" }), rep("c", ["crowded"], 5)]);
    expect(p.photos.map((x) => x.url)).toEqual(["https://sb/b/new.jpg", "https://sb/a/old.jpg"]);
    expect(p.photos[0].ageText).toBe("20 min ago");
  });

  it("sorts the most trustworthy and freshest information first", () => {
    const p = pulse([rep("a", ["crowded"], 10), rep("b", ["muddy"], 60 * 30)], {
      hours: "24/7", weather: { time: "2026-10-10T08:00:00Z", tempC: 27.4, precipMm: 0, precipProb: 20 },
    });
    expect(p.signals.map((s) => s.source)).toEqual(["recent", "forecast", "map-data", "community"]);
    expect(p.signals.find((s) => s.source === "forecast")!.value).toBe("27°C · 20% chance of rain");
  });
});

describe("Trip Health", () => {
  const base = { finishMin: 17 * 60, nowLocalMin: 10 * 60, dayEndMin: 20 * 60, driveMinutesLeft: 100, delayMin: null as number | null, hasWeather: true, advice: [] };
  it("schedule: comfortable / tight / over / behind", () => {
    expect(computeHealth(base).schedule).toMatchObject({ label: "Comfortable", tone: "good" });
    expect(computeHealth({ ...base, finishMin: 19 * 60 }).schedule).toMatchObject({ label: "Tight", tone: "warn" });
    expect(computeHealth({ ...base, finishMin: 21 * 60 }).schedule).toMatchObject({ label: "Over time", tone: "bad" });
    expect(computeHealth({ ...base, delayMin: 45 }).schedule).toMatchObject({ label: "Behind", tone: "bad" });
    expect(computeHealth({ ...base, finishMin: null }).schedule.label).toBe("Nothing left");
  });
  it("driving load and time left", () => {
    expect(computeHealth(base).driving).toMatchObject({ label: "Light" });
    expect(computeHealth({ ...base, driveMinutesLeft: 200 }).driving.label).toBe("Moderate");
    expect(computeHealth({ ...base, driveMinutesLeft: 400 }).driving.label).toBe("Heavy");
    expect(computeHealth(base).timeLeftMin).toBe(600);
  });
  it("weather is 'unknown' without a forecast — never 'good' by default", () => {
    expect(computeHealth({ ...base, hasWeather: false }).weather).toMatchObject({ label: "Unknown", tone: "unknown" });
    expect(computeHealth(base).weather.label).toBe("Good");
    const rain = { id: "rain-a", kind: "weather" as const, priority: 85, urgency: "soon" as const, title: "Rain likely at Fort", detail: "" };
    expect(computeHealth({ ...base, advice: [rain] }).weather).toMatchObject({ label: "Poor", tone: "bad" });
    expect(computeHealth({ ...base, advice: [{ ...rain, priority: 70 }] }).weather.label).toBe("Watch");
  });
});

describe("Plan vs Reality learning", () => {
  // India time; the trip starts on Sat 10 Oct 2026.
  const at = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, 9 + day, h, m) - OFFSET * 60_000).toISOString();
  const place = (day: number, plannedHHMM: string, cat: string, status: LearnPlace["status"], doneAt: string | null): LearnPlace => ({
    name: `${cat}-${day}-${plannedHHMM}`, category: cat, day_number: day, status, status_at: doneAt, arrival_time: plannedHHMM,
  });
  const trip = (places: LearnPlace[]): LearnTrip => ({ id: "t1", name: "Vizag", num_days: 3, start_date: "2026-10-10", places });

  it("says nothing about someone's style until there is enough evidence", () => {
    const l = learnFromTrips([trip([place(1, "09:00", "fort", "done", at(1, 11, 30)), place(1, "12:00", "lake", "skipped", null)])], OFFSET);
    expect(l.enough).toBe(false);
    expect(l.insights).toEqual([]);
    expect(l.done).toBe(1);
    expect(l.skipped).toBe(1);
  });

  it("measures planned vs reality for one trip, comparing against planned arrival + the usual stay", () => {
    // fort stay = 2.5 h: planned 09:00 → expected done 11:30. Marked at 12:30 → 60 min late.
    const t = trip([
      place(1, "09:00", "fort", "done", at(1, 12, 30)),
      place(1, "13:00", "fort", "done", at(1, 16, 30)), // expected 15:30 → +60
      place(2, "09:00", "fort", "done", at(2, 12, 30)), // +60
      place(2, "13:00", "lake", "skipped", null),
      place(3, "10:00", "lake", "planned", null),
    ]);
    const r = tripReality(t, OFFSET);
    expect(r).toMatchObject({ scheduled: 5, done: 3, skipped: 1, notDone: 1, medianDelayMin: 60, delaySamples: 3 });
    expect(r.completionRate).toBeCloseTo(0.6);
  });

  it("ignores stops marked done on a different day than planned (not comparable)", () => {
    const t = trip([1, 2, 3].map((i) => place(1, "09:00", "fort", "done", at(2, 12, i))));
    expect(tripReality(t, OFFSET).medianDelayMin).toBeNull();
  });

  it("derives a few honest traits, each with its evidence", () => {
    const t = trip([
      // day 1: planned 4, done 2 · day 2: planned 4, done 2 · slow starts · always late
      place(1, "08:00", "fort", "done", at(1, 12, 0)), place(1, "11:00", "fort", "done", at(1, 16, 0)), place(1, "14:00", "temple", "skipped", null), place(1, "16:00", "temple", "skipped", null),
      place(2, "08:00", "fort", "done", at(2, 12, 0)), place(2, "11:00", "fort", "done", at(2, 16, 0)), place(2, "14:00", "temple", "skipped", null), place(2, "16:00", "temple", "skipped", null),
      place(3, "08:00", "fort", "done", at(3, 12, 0)),
    ]);
    const l = learnFromTrips([t], OFFSET);
    expect(l.enough).toBe(true);
    const ids = l.insights.map((i) => i.id);
    expect(ids).toContain("packed"); // planned 4 / 4 / 1, finished 2 / 2 / 1
    expect(ids).toContain("behind");
    expect(ids).toContain("slow-mornings");
    expect(ids).toContain("skips-temple");
    expect(l.insights.find((i) => i.id === "skips-temple")!.evidence).toBe("4 of 4 were skipped.");
    expect(l.insights.every((i) => i.evidence.length > 10)).toBe(true);
  });

  it("recognises someone who sticks to the plan, and does not call them behind", () => {
    const places = [1, 2, 3].flatMap((d) => [place(d, "09:00", "viewpoint", "done", at(d, 9, 50)), place(d, "12:00", "viewpoint", "done", at(d, 12, 50))]);
    const l = learnFromTrips([trip(places)], OFFSET);
    expect(l.insights.map((i) => i.id)).toEqual(expect.arrayContaining(["sticks", "on-time"]));
    expect(l.insights.map((i) => i.id)).not.toContain("behind");
  });
});
