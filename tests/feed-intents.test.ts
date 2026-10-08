import { describe, expect, it } from "vitest";
import { INTENT_IDS, INTENTS } from "@/lib/feed/config";
import { rankFeed, type RankInput } from "@/lib/feed/rank";
import { usefulness } from "@/lib/feed/scoring";
import type { FeedCandidate } from "@/lib/feed/types";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
let seq = 1;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cand = (o: Omit<Partial<FeedCandidate>, "counters"> & { hours?: number; counters?: Partial<FeedCandidate["counters"]> } = {}): FeedCandidate => {
  const { hours = 6, counters, ...rest } = o; const n = seq++;
  return {
    id: uid(n), authorId: uid(1000 + n), username: `u${n}`, displayName: null, destinationId: uid(2000 + n), destinationName: `D${n}`, destinationSlug: `d${n}`, destinationPosts: 8,
    kind: "photo", caption: null, placeName: `P${n}`, lat: 18.98, lng: 73.26, locationPrecision: "approx", capturedAt: hoursAgo(hours), createdAt: hoursAgo(hours), commentsAllowed: "everyone", durationS: null,
    counters: { likes: 0, comments: 0, saves: 0, shares: 0, helpful: 0, tripAdds: 0, impressions: 100, plays: 0, completions: 0, skips: 0, watchMs: 0, ...counters },
    crowd: null, conditions: [], vibes: [], tip: null, fromArea: false, helped: false, pools: ["fresh"], followed: false, liked: false, saved: false, seenAt: null, seenPct: null, ...rest,
  };
};
const input = (o: Partial<RankInput> = {}): RankInput => ({ nowMs: NOW, userId: uid(9), tripDestinationIds: new Set(), affinity: new Map(), interests: [], position: null, seed: "s", ...o });
const detailed = { tip: "Go before 9 AM", crowd: "quiet" as const, conditions: ["road_good"], vibes: ["best_view"], caption: "A long enough caption to count as a real description of the place." };

describe("usefulness", () => {
  it("rewards what a planner can use: a tip, conditions, a crowd level, and real caption", () => {
    const bare = usefulness(cand());
    const rich = usefulness(cand(detailed));
    expect(rich).toBeGreaterThan(bare + 0.3);
    expect(usefulness(cand({ tip: "Go early" }))).toBeGreaterThan(usefulness(cand({ vibes: ["food"] })));   // a tip says more than a tag
  });
  it("and what other travelers said back — smoothed, so one vote on two views is not a verdict", () => {
    const proven = usefulness(cand({ counters: { helpful: 40, tripAdds: 15, impressions: 300 } }));
    const noise = usefulness(cand({ counters: { helpful: 1, impressions: 2 } }));
    expect(proven).toBeGreaterThan(noise + 0.2);
    expect(noise).toBeLessThan(0.4);
    for (const v of [bareCase(), proven, noise]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});
const bareCase = () => usefulness(cand());

describe("Helpful and trip adds are the strongest planning signals", () => {
  it("a post people used to plan outranks a post with many more likes and no planning value", () => {
    const pretty = cand({ hours: 20, counters: { likes: 120, impressions: 600 } });
    const useful = cand({ hours: 20, ...detailed, counters: { likes: 25, helpful: 30, tripAdds: 12, impressions: 600 } });
    expect(rankFeed([pretty, useful], input(), { n: 2, intent: "planning" })[0].candidate.id).toBe(useful.id);
  });
});

describe("intent modes", () => {
  it("every mode's weights add up to 1, so no mode can quietly shout louder than another", () => {
    for (const id of INTENT_IDS) { const w = INTENTS[id].weights; expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6); }
  });
  it("Right now: only this week's posts, freshest first", () => {
    const old = cand({ hours: 24 * 20, counters: { likes: 500, impressions: 900 } });
    const today = cand({ hours: 3 }); const lastWeek = cand({ hours: 24 * 5 });
    const r = rankFeed([old, lastWeek, today], input(), { intent: "now" });
    expect(r.map((x) => x.candidate.id)).toEqual([today.id, lastWeek.id]);        // the 20-day-old favourite is not "right now"
  });
  it("My trip: only destinations on the trip", () => {
    const mine = cand(); const other = cand({ counters: { likes: 90, impressions: 100 } });
    const r = rankFeed([other, mine], input({ tripDestinationIds: new Set([mine.destinationId]) }), { intent: "trip" });
    expect(r.map((x) => x.candidate.id)).toEqual([mine.id]);
    expect(rankFeed([other, mine], input(), { intent: "trip" })).toEqual([]);      // no trip, nothing to show (the service explains why)
  });
  it("Planning favours the detailed post over the prettier bare one; For you does not care as much", () => {
    const bare = cand({ hours: 10, counters: { likes: 60, impressions: 300 } });
    const rich = cand({ hours: 10, ...detailed, counters: { likes: 20, impressions: 300 } });
    expect(rankFeed([bare, rich], input(), { n: 2, intent: "planning" })[0].candidate.id).toBe(rich.id);
    expect(rankFeed([bare, rich], input(), { n: 2, intent: "for_you" })[0].candidate.id).toBe(bare.id);
  });
  it("Hidden gems: a well-liked place few have posted about beats the crowded favourite", () => {
    const famous = cand({ destinationPosts: 400, hours: 10, counters: { likes: 60, saves: 15, impressions: 400 } });
    const gem = cand({ destinationPosts: 2, hours: 10, vibes: ["hidden_gem", "best_view"], tip: "Take the left path", counters: { likes: 50, saves: 14, impressions: 400 } });
    expect(rankFeed([famous, gem], input(), { n: 2, intent: "gems" })[0].candidate.id).toBe(gem.id);
    expect(rankFeed([famous, gem], input(), { n: 2, intent: "for_you" })[0].candidate.id).toBe(famous.id);
  });
  it("the default mode behaves as before (and still gives a new person a full feed)", () => {
    const list = Array.from({ length: 6 }, () => cand());
    expect(rankFeed(list, input(), { n: 6 })).toHaveLength(6);
    expect(rankFeed(list, input(), { n: 6, intent: "for_you" }).map((x) => x.candidate.id)).toEqual(rankFeed(list, input(), { n: 6 }).map((x) => x.candidate.id));
  });
});
