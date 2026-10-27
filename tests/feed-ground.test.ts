import { describe, expect, it } from "vitest";
import { groundReport } from "@/lib/feed/ground";
import { AVATAR_TONES, avatarTone, compact, initialOf } from "@/lib/feed/people";
import { CARD_RATIO, PAGE_RATIO, ratioOf } from "@/lib/feed/aspect";

const fresh = { label: "2 hours ago", state: "today", dot: "green", usableAsCurrent: true } as const;
const old = { label: "3 weeks ago", state: "older", dot: "grey", usableAsCurrent: false } as const;
const exp = (o: object = {}) => ({ crowd: null, conditions: [], vibes: [], tip: null, fromArea: false, ...o });

describe("ground report: what the traveler said, and how far to trust it", () => {
  it("a recent post is current, and its warnings are real warnings", () => {
    const g = groundReport({ freshness: fresh, experience: exp({ crowd: "crowded", conditions: ["road_good", "long_queue"], vibes: ["family"] }) });
    expect(g.current).toBe(true);
    expect(g.stamp).toBe("Current · 2 hours ago");
    expect(g.crowd).toMatchObject({ label: "Crowded", filled: 3, tone: "warn" });
    expect(g.chips[0]).toMatchObject({ id: "long_queue", tone: "warn" });          // warnings first
    expect(g.chips.map((c) => c.id)).toEqual(["long_queue", "road_good", "family"]);
    expect(g.warnings).toBe(1);
    expect(g.atTheTime).toBe(false);
  });

  it("an old post is never called current and never raises an alarm: conditions change", () => {
    const g = groundReport({ freshness: old, experience: exp({ crowd: "crowded", conditions: ["closed", "road_bad"] }) });
    expect(g.current).toBe(false);
    expect(g.stamp).toBe("3 weeks ago");
    expect(g.stamp).not.toContain("Current");
    expect(g.crowd?.tone).toBe("neutral");
    expect(g.chips.every((c) => c.tone === "neutral")).toBe(true);
    expect(g.warnings).toBe(0);
    expect(g.atTheTime).toBe(true);                                                  // the screen says "at the time of the post"
  });

  it("says nothing it was not told: no detail means empty, not invented chips", () => {
    const g = groundReport({ freshness: fresh, experience: exp() });
    expect(g.empty).toBe(true);
    expect(g.chips).toEqual([]);
    expect(g.crowd).toBeNull();
    expect(groundReport({ freshness: fresh, experience: exp({ tip: "Go before 9" }) }).empty).toBe(false);
    expect(groundReport({ freshness: fresh, experience: exp({ fromArea: true }) }).empty).toBe(false);
  });

  it("the crowd meter fills one, two or three steps", () => {
    const f = (c: "quiet" | "moderate" | "crowded") => groundReport({ freshness: fresh, experience: exp({ crowd: c }) }).crowd;
    expect([f("quiet")?.filled, f("moderate")?.filled, f("crowded")?.filled]).toEqual([1, 2, 3]);
    expect(f("quiet")?.tone).toBe("good");
  });
});

describe("people helpers", () => {
  it("the same name always gets the same theme colour, and only theme colours", () => {
    expect(avatarTone("ravi")).toBe(avatarTone("ravi"));
    for (const n of ["ravi", "anita", "x", "a_b_c", "traveler99"]) expect(AVATAR_TONES).toContain(avatarTone(n) as never);
    expect(AVATAR_TONES.join(" ")).not.toMatch(/#|\[/);                              // no fixed colour values
  });
  it("initials come from the display name first, then the username, and never break on emoji", () => {
    expect(initialOf("ravi")).toBe("R");
    expect(initialOf("ravi", "  Sita Devi ")).toBe("S");
    expect(initialOf("x", "🌄 Hills")).toBe("🌄");
    expect(initialOf("")).toBe("?");
  });
  it("counts fit a small button", () => {
    expect([0, 12, 999, 1000, 1500, 12_340, 1_000_000, 2_500_000].map(compact)).toEqual(["0", "12", "999", "1k", "1.5k", "12.3k", "1M", "2.5M"]);
    expect(compact(-3)).toBe("0"); expect(compact(Number.NaN)).toBe("0");
  });
});

describe("picture shape", () => {
  it("keeps the photo's own shape inside limits, and falls back when the size is unknown", () => {
    expect(ratioOf({ width: 1080, height: 1350 }, CARD_RATIO)).toBeCloseTo(0.8);
    expect(ratioOf({ width: 720, height: 1280 }, CARD_RATIO)).toBe(CARD_RATIO.min);        // a very tall video is cropped to 4:5 in the feed
    expect(ratioOf({ width: 720, height: 1280 }, PAGE_RATIO)).toBeCloseTo(0.5625 < PAGE_RATIO.min ? PAGE_RATIO.min : 0.5625);
    expect(ratioOf({ width: 4000, height: 1000 }, CARD_RATIO)).toBe(CARD_RATIO.max);
    expect(ratioOf({ width: null, height: null }, CARD_RATIO)).toBe(CARD_RATIO.fallback);
    expect(ratioOf(undefined, PAGE_RATIO)).toBe(PAGE_RATIO.fallback);
    expect(ratioOf({ width: 0, height: 10 }, CARD_RATIO)).toBe(CARD_RATIO.fallback);
  });
});
