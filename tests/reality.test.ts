import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONDITION_IDS, CONDITIONS, CROWD_LEVELS, hasTravelDetail, LIMITS, VIBE_IDS } from "@/lib/feed/experience";
import { readConditions, readCrowd, summarizeReality, type PulseRaw } from "@/lib/feed/reality";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const h = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const crowd = (...r: [string, number][]) => r.map(([level, hours]) => ({ level, at: h(hours) }));

describe("one vocabulary everywhere", () => {
  it("the database constraints and the app list exactly the same crowd levels, conditions and vibes", () => {
    const sql = readFileSync(join(__dirname, "..", "supabase", "migrations", "20261015000000_travel_intelligence.sql"), "utf8");
    const list = (name: string) => [...new RegExp(`${name} <@ array\\[([^\\]]+)\\]`).exec(sql)![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(list("conditions").sort()).toEqual([...CONDITION_IDS].sort());
    expect(list("vibes").sort()).toEqual([...VIBE_IDS].sort());
    expect([...new RegExp("crowd in \\(([^)]+)\\)").exec(sql)![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual([...CROWD_LEVELS]);
    expect(new RegExp(`cardinality\\(conditions\\) <= ${LIMITS.conditions}`).test(sql)).toBe(true);
    expect(new RegExp(`cardinality\\(vibes\\) <= ${LIMITS.vibes}`).test(sql)).toBe(true);
    expect(sql).toContain(`between ${LIMITS.tipMin} and ${LIMITS.tipMax}`);
  });
  it("every condition has a lifetime, and quick-changing ones are shorter than slow ones", () => {
    expect(CONDITIONS.every((c) => c.ttlHours > 0)).toBe(true);
    const ttl = (id: string) => CONDITIONS.find((c) => c.id === id)!.ttlHours;
    expect(ttl("long_queue")).toBeLessThan(ttl("closed")); expect(ttl("closed")).toBeLessThan(ttl("construction"));
  });
  it("knows whether a post says anything beyond the picture", () => {
    expect(hasTravelDetail({ crowd: null, conditions: [], vibes: [], tip: null })).toBe(false);
    expect(hasTravelDetail({ crowd: "quiet", conditions: [], vibes: [], tip: null })).toBe(true);
    expect(hasTravelDetail({ crowd: null, conditions: [], vibes: [], tip: "Go early" })).toBe(true);
  });
});

describe("crowd: claims only as strong as the evidence", () => {
  it("one report is one traveler's report, never 'usually quiet'", () => {
    const r = readCrowd(crowd(["quiet", 2]), NOW);
    expect(r.level).toBeNull(); expect(r.confidence).toBe("low"); expect(r.note).toMatch(/One traveler said quiet/); expect(r.note).toMatch(/Not enough/);
  });
  it("two or more recent reports that agree make a call, with the numbers shown", () => {
    const r = readCrowd(crowd(["crowded", 1], ["crowded", 3], ["moderate", 5]), NOW);
    expect(r).toMatchObject({ level: "crowded", confidence: "good", recent: 3, agreeing: 2 }); expect(r.note).toBe("2 of 3 travelers in the last day say crowded.");
    expect(readCrowd(crowd(["quiet", 1], ["quiet", 2]), NOW)).toMatchObject({ level: "quiet", confidence: "low" });      // only two: a call, but flagged as low confidence
  });
  it("newer reports outweigh older ones: this morning beats last night", () => {
    const r = readCrowd(crowd(["quiet", 1], ["quiet", 2], ["crowded", 20], ["crowded", 21]), NOW);
    expect(r.level).toBe("quiet");
  });
  it("a genuine split makes no call", () => {
    const r = readCrowd(crowd(["quiet", 2], ["crowded", 2]), NOW);
    expect(r.level).toBeNull(); expect(r.note).toMatch(/Mixed reports from 2/);
  });
  it("reports older than a day are not 'right now': it says so and mentions the earlier ones", () => {
    const r = readCrowd(crowd(["crowded", 30], ["crowded", 40]), NOW);
    expect(r.level).toBeNull(); expect(r.confidence).toBe("none"); expect(r.note).toMatch(/No crowd reports in the last day \(2 in the last 3 days\)/);
    expect(readCrowd([], NOW).note).toBe("No crowd reports yet.");
  });
  it("ignores levels it does not know and timestamps it cannot read", () => {
    expect(readCrowd([{ level: "packed", at: h(1) }, { level: "quiet", at: "garbage" }], NOW).recent).toBe(0);
  });
});

describe("conditions expire on their own clocks", () => {
  it("a queue report is gone after 4 hours, a construction report is still true after a day", () => {
    const r = readConditions([{ id: "long_queue", at: h(5) }, { id: "construction", at: h(26) }, { id: "parking_full", at: h(1) }], NOW);
    expect(r.map((c) => c.id)).toEqual(["parking_full", "construction"]);
  });
  it("merges repeated reports, keeps the latest time, flags warnings, and drops unknown kinds", () => {
    const r = readConditions([{ id: "closed", at: h(3) }, { id: "closed", at: h(1) }, { id: "sunny", at: h(2) }, { id: "volcano", at: h(1) }], NOW);
    expect(r).toHaveLength(2);
    const closed = r.find((c) => c.id === "closed")!;
    expect(closed).toMatchObject({ reports: 2, warning: true, label: "Closed" }); expect(closed.ageMs).toBe(3_600_000);
    expect(r.find((c) => c.id === "sunny")!.warning).toBe(false);
  });
});

describe("the whole destination summary", () => {
  const raw = (o: Partial<PulseRaw> = {}): PulseRaw => ({ total_30d: 9, posts_24h: 2, posts_7d: 6, videos_7d: 3, contributors_7d: 4, from_area_7d: 2, trip_adds_30d: 5, crowd: [], conditions: [], vibes: [{ id: "best_view", n: 4 }], tips: [{ text: "Go before 9", at: h(2), by: "ravi" }], ...o });
  it("reports activity, labelled vibes and tips", () => {
    const s = summarizeReality(raw(), NOW);
    expect(s.activity).toEqual({ today: 2, week: 6, videos: 3, contributors: 4, fromArea: 2, tripAdds: 5, total30d: 9 });
    expect(s.vibes[0]).toEqual({ id: "best_view", label: "Best view", n: 4 }); expect(s.tips[0].by).toBe("ravi"); expect(s.quiet).toBe(false);
  });
  it("a destination with nothing recent is plainly quiet, and malformed data never throws", () => {
    expect(summarizeReality(raw({ posts_7d: 0, posts_24h: 0 }), NOW).quiet).toBe(true);
    expect(() => summarizeReality({} as PulseRaw, NOW)).not.toThrow();
    expect(summarizeReality({} as PulseRaw, NOW).quiet).toBe(true);
  });
});
