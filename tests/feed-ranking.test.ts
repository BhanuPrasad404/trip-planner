import { describe, expect, it } from "vitest";
import { rankFeed, type RankInput } from "@/lib/feed/rank";
import { completionQuality, engagementQuality, freshness, isColdStart, makeScorer, penalty, popularity, quality, relevance, skipRate, velocity } from "@/lib/feed/scoring";
import { diversify } from "@/lib/feed/diversity";
import { decodeCursor, encodeCursor } from "@/lib/feed/cursor";
import type { FeedCandidate, FeedContext } from "@/lib/feed/types";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let seq = 1;

const cand = (o: Omit<Partial<FeedCandidate>, "counters"> & { hours?: number; counters?: Partial<FeedCandidate["counters"]> } = {}): FeedCandidate => {
  const { hours = 6, counters, ...rest } = o;
  const n = seq++;
  return {
    id: uid(n), authorId: uid(1000 + n), username: `u${n}`, displayName: null,
    destinationId: uid(2000 + n), destinationName: `Dest ${n}`, destinationSlug: `dest-${n}`, destinationPosts: 5,
    kind: "photo", caption: null, placeName: `Place ${n}`, lat: 18.98, lng: 73.26, locationPrecision: "approx",
    capturedAt: hoursAgo(hours), createdAt: hoursAgo(hours), commentsAllowed: "everyone", durationS: null,
    counters: { likes: 0, comments: 0, saves: 0, shares: 0, helpful: 0, tripAdds: 0, impressions: 0, plays: 0, completions: 0, skips: 0, watchMs: 0, ...counters },
    crowd: null, conditions: [], vibes: [], tip: null, fromArea: false, helped: false,
    pools: ["fresh"], followed: false, liked: false, saved: false, seenAt: null, seenPct: null, ...rest,
  };
};
const input = (o: Partial<RankInput> = {}): RankInput => ({
  nowMs: NOW, userId: uid(9), tripDestinationIds: new Set(), affinity: new Map(), interests: [], position: null, seed: "s1", ...o,
});
const ctxOf = (o: Partial<FeedContext> = {}): FeedContext => ({ ...input(), destinationEngagement: new Map(), ...o });

describe("scoring components", () => {
  it("freshness halves at the half-life, and reports go stale much faster than photos", () => {
    expect(freshness(cand({ kind: "photo", hours: 0 }), NOW)).toBeCloseTo(1, 2);
    expect(freshness(cand({ kind: "photo", hours: 24 * 14 }), NOW)).toBeCloseTo(0.5, 2);
    expect(freshness(cand({ kind: "report", hours: 48 }), NOW)).toBeCloseTo(0.5, 2);
    expect(freshness(cand({ kind: "report", hours: 96 }), NOW)).toBeLessThan(freshness(cand({ kind: "photo", hours: 96 }), NOW));
    expect(freshness(cand({ hours: 24 * 400 }), NOW)).toBeGreaterThan(0); // never exactly zero
  });

  it("a post can never look fresher than its upload (a claimed capture time in the future is ignored)", () => {
    const c = cand({ hours: 50, capturedAt: new Date(NOW + 5 * 3_600_000).toISOString() });
    expect(freshness(c, NOW)).toBeLessThan(freshness(cand({ hours: 1 }), NOW));
  });

  it("relevance: a trip destination is fully relevant; weak evidence combines instead of adding up", () => {
    const c = cand();
    expect(relevance(c, ctxOf({ tripDestinationIds: new Set([c.destinationId]) }))).toBe(1);
    expect(relevance(c, ctxOf())).toBe(0);
    const aff = relevance(c, ctxOf({ affinity: new Map([[c.destinationId, 2]]) }));
    expect(aff).toBeGreaterThan(0.3); expect(aff).toBeLessThan(0.9);
    const both = relevance(c, ctxOf({ affinity: new Map([[c.destinationId, 2]]), position: { lat: 18.98, lng: 73.26 } }));
    expect(both).toBeGreaterThan(aff); expect(both).toBeLessThanOrEqual(1);
  });

  it("relevance by location fades with distance and stops at 150 km", () => {
    const here = relevance(cand(), ctxOf({ position: { lat: 18.98, lng: 73.26 } }));
    const mid = relevance(cand(), ctxOf({ position: { lat: 19.7, lng: 73.26 } }));      // ≈ 80 km
    const far = relevance(cand(), ctxOf({ position: { lat: 28.6, lng: 77.2 } }));       // Delhi
    expect(here).toBeGreaterThan(mid); expect(mid).toBeGreaterThan(0); expect(far).toBe(0);
  });

  it("relevance by interests looks at caption, place and destination", () => {
    expect(relevance(cand({ caption: "Waterfall after rain" }), ctxOf({ interests: ["waterfall"] }))).toBeGreaterThan(0);
    expect(relevance(cand({ caption: "Sunset" }), ctxOf({ interests: ["waterfall"] }))).toBe(0);
  });

  it("quality is smoothed: 1 like on 2 views is NOT a star; the same rate on 2000 views is", () => {
    const tiny = cand({ counters: { likes: 1, impressions: 2 } });
    const proven = cand({ counters: { likes: 1000, impressions: 2000 } });
    expect(engagementQuality(proven)).toBeGreaterThan(engagementQuality(tiny) + 0.2);
    expect(engagementQuality(cand())).toBeGreaterThan(0.3); // brand-new = neutral, not zero
    expect(engagementQuality(cand())).toBeLessThan(0.7);
  });

  it("video quality rewards watching to the end and punishes a skip rate far above normal", () => {
    const watched = cand({ kind: "video", counters: { plays: 200, completions: 160, impressions: 220, skips: 10 } });
    const abandoned = cand({ kind: "video", counters: { plays: 200, completions: 10, impressions: 220, skips: 10 } });
    const skipped = cand({ kind: "video", counters: { plays: 200, completions: 160, impressions: 220, skips: 190 } });
    expect(completionQuality(watched)).toBeGreaterThan(completionQuality(abandoned));
    expect(quality(watched)).toBeGreaterThan(quality(abandoned));
    expect(skipRate(skipped)).toBeGreaterThan(0.7);
    expect(quality(skipped)).toBeLessThan(quality(watched));
  });

  it("velocity favours the same engagement packed into fewer hours", () => {
    const burst = cand({ hours: 3, counters: { likes: 30, saves: 10 } });
    const slow = cand({ hours: 300, counters: { likes: 30, saves: 10 } });
    expect(velocity(burst, NOW)).toBeGreaterThan(velocity(slow, NOW));
  });

  it("popularity grows with the destination's content, with diminishing returns", () => {
    const p = (n: number) => popularity(cand({ destinationPosts: n }), ctxOf());
    expect(p(1)).toBeLessThan(p(10)); expect(p(10)).toBeLessThan(p(50)); expect(p(500)).toBeLessThanOrEqual(1);
  });

  it("penalties: just-seen is heavy, old-seen fades, watched-through adds, own posts drop, mass-skipped drops", () => {
    const base = cand();
    const ctx = ctxOf();
    expect(penalty(base, ctx)).toBe(0);
    const justSeen = penalty({ ...base, seenAt: hoursAgo(2), seenPct: 10 }, ctx);
    const weekOld = penalty({ ...base, seenAt: hoursAgo(24 * 7), seenPct: 10 }, ctx);
    expect(justSeen).toBeGreaterThan(0.8); expect(weekOld).toBeLessThan(justSeen / 3); expect(weekOld).toBeGreaterThan(0);
    expect(penalty({ ...base, seenAt: hoursAgo(2), seenPct: 100 }, ctx)).toBeGreaterThan(justSeen);
    expect(penalty({ ...base, authorId: ctx.userId }, ctx)).toBeGreaterThan(0.3);
    expect(penalty(cand({ counters: { impressions: 100, skips: 90 } }), ctx)).toBeGreaterThan(0);
  });

  it("every component stays in 0..1 and the scorer is exposed behind an interface (replaceable by a model later)", () => {
    const s = makeScorer().score(cand({ counters: { likes: 9999, saves: 9999, comments: 9999, impressions: 1 } }), ctxOf());
    for (const [k, v] of Object.entries(s.parts)) if (k !== "penalty") { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(makeScorer().id).toBe("heuristic-v1");
    expect(makeScorer(undefined, undefined, true).id).toBe("heuristic-v1-cold");
  });
});

describe("cold start", () => {
  it("knows when it knows nothing", () => {
    expect(isColdStart(ctxOf(), false)).toBe(true);
    expect(isColdStart(ctxOf({ interests: ["trek"] }), false)).toBe(false);
    expect(isColdStart(ctxOf(), true)).toBe(false);
  });

  it("a brand-new user still gets a full, sensible feed: fresh, well-received, popular content first", () => {
    const stale = cand({ hours: 24 * 90, counters: { impressions: 400, likes: 20 } });
    const freshGood = cand({ hours: 5, destinationPosts: 40, counters: { impressions: 300, likes: 60, saves: 20, comments: 8 } });
    const freshQuiet = cand({ hours: 5, counters: { impressions: 300, likes: 2 } });
    const ranked = rankFeed([stale, freshQuiet, freshGood], input(), { n: 3 });
    expect(ranked).toHaveLength(3);                                   // never empty
    expect(ranked[0].candidate.id).toBe(freshGood.id);
    expect(ranked[2].candidate.id).toBe(stale.id);
  });

  it("returns nothing only when there is truly nothing", () => {
    expect(rankFeed([], input())).toEqual([]);
  });
});

describe("personalisation", () => {
  it("a post at a destination on my trip beats a slightly better post elsewhere", () => {
    const mine = cand({ hours: 20, counters: { impressions: 100, likes: 5 } });
    const other = cand({ hours: 20, counters: { impressions: 100, likes: 20, saves: 6 } });
    const r = rankFeed([other, mine], input({ tripDestinationIds: new Set([mine.destinationId]) }), { n: 2 });
    expect(r[0].candidate.id).toBe(mine.id);
  });

  it("people I follow are lifted", () => {
    const friend = cand({ followed: true, hours: 30 });
    const stranger = cand({ hours: 30 });
    expect(rankFeed([stranger, friend], input(), { n: 2 })[0].candidate.id).toBe(friend.id);
  });

  it("what I have just seen sinks, so scrolling back never feels like a loop", () => {
    const seen = cand({ hours: 3, counters: { impressions: 200, likes: 50 }, seenAt: hoursAgo(1), seenPct: 100 });
    const unseen = cand({ hours: 30, counters: { impressions: 200, likes: 10 } });
    expect(rankFeed([seen, unseen], input(), { n: 2 })[0].candidate.id).toBe(unseen.id);
  });

  it("excluded ids never come back and duplicates from several pools are merged", () => {
    const a = cand(); const b = cand();
    const r = rankFeed([a, { ...a, pools: ["near"] }, b], input(), { exclude: new Set([b.id]) });
    expect(r.map((x) => x.candidate.id)).toEqual([a.id]);
  });
});

describe("diversity", () => {
  const manyFrom = (dest: string, author: string, n: number, extra: Omit<Partial<FeedCandidate>, "counters"> = {}) =>
    Array.from({ length: n }, () => cand({ destinationId: dest, authorId: author, hours: 2, counters: { impressions: 200, likes: 40, saves: 10 }, ...extra }));

  it("never shows a creator twice in a row or more than two in a row from one destination when alternatives exist", () => {
    const flood = manyFrom(uid(7001), uid(8001), 12);                       // one creator, one destination, great stats
    const others = Array.from({ length: 12 }, () => cand({ hours: 40, counters: { impressions: 100, likes: 3 } }));
    const r = rankFeed([...flood, ...others], input(), { n: 24 });
    // The rules hold for as long as alternatives exist; once all 12 "others" are used, repeats are the only thing left (and are allowed).
    const lastOther = r.map((x) => x.candidate.authorId).reduce((acc, a, i) => (a === uid(8001) ? acc : i), 0);
    expect(lastOther).toBeGreaterThanOrEqual(11);
    for (let i = 1; i <= lastOther; i++) expect(r[i].candidate.authorId === r[i - 1].candidate.authorId).toBe(false);
    for (let i = 2; i <= lastOther; i++) {
      const same = r[i].candidate.destinationId === r[i - 1].candidate.destinationId && r[i].candidate.destinationId === r[i - 2].candidate.destinationId;
      expect(same).toBe(false);
    }
    expect(r.slice(0, 10).filter((x) => x.candidate.authorId === uid(8001)).length).toBeLessThanOrEqual(4);   // 12 great posts from one creator: at most 4 of the first 10
    expect(r).toHaveLength(24);
  });

  it("relaxes its own rules rather than returning an empty feed when only one creator/destination exists", () => {
    const only = manyFrom(uid(7002), uid(8002), 6);
    expect(rankFeed(only, input(), { n: 6 })).toHaveLength(6);
  });

  it("mixes content types: a run of photos makes way for a video when one is nearly as good", () => {
    const photos = Array.from({ length: 6 }, () => cand({ kind: "photo", hours: 4, counters: { impressions: 200, likes: 30 } }));
    const video = cand({ kind: "video", hours: 4, durationS: 20, counters: { impressions: 200, likes: 29, plays: 100, completions: 40 } });
    const r = rankFeed([...photos, video], input(), { n: 7 });
    expect(r.findIndex((x) => x.candidate.id === video.id)).toBeLessThan(5);
  });

  it("every 5th slot can go to a good, barely-seen new post (exploration), but not to a poor one", () => {
    const proven = Array.from({ length: 10 }, () => cand({ hours: 30, counters: { impressions: 500, likes: 80, saves: 25 } }));
    const newcomer = cand({ hours: 2, counters: { impressions: 0 } });
    const r = rankFeed([...proven, newcomer], input(), { n: 11 });
    const at = r.findIndex((x) => x.candidate.id === newcomer.id);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThanOrEqual(9);
    const junk = cand({ hours: 24 * 5, counters: { impressions: 0 }, kind: "report" });
    const r2 = rankFeed([...proven, junk], input(), { n: 11, scorer: { id: "x", score: (c) => ({ candidate: c, score: c.id === junk.id ? 0.01 : 1, parts: { relevance: 0, freshness: 0, quality: 0, velocity: 0, popularity: 0, social: 0, exploration: c.id === junk.id ? 1 : 0, usefulness: 0, penalty: 0 } }) } });
    expect(r2.findIndex((x) => x.candidate.id === junk.id)).toBe(10); // exploration never promotes something far worse than the alternatives
  });

  it("does not let a penalty be 'discounted' away: negative scores stay negative", () => {
    const s = makeScorer().score(cand({ authorId: uid(9) }), ctxOf());
    const out = diversify([{ ...s, score: -0.5 }], 1, "s");
    expect(out[0].adjusted).toBeLessThan(0);
  });
});

describe("determinism", () => {
  it("same input and seed give exactly the same feed; a new seed only reshuffles ties", () => {
    const cs = Array.from({ length: 30 }, (_, i) => cand({ hours: 10 + (i % 3), counters: { impressions: 100, likes: 5 } }));
    const ids = (seed: string) => rankFeed(cs, input({ seed }), { n: 30 }).map((x) => x.candidate.id);
    expect(ids("a")).toEqual(ids("a"));
    expect(new Set(ids("a"))).toEqual(new Set(ids("b")));
  });
});

describe("cursor", () => {
  it("round-trips and survives being carried in a request", () => {
    const c = { ids: [uid(1), uid(2)], seen: [uid(3)], gen: 2 };
    expect(decodeCursor(encodeCursor(c))).toEqual({ v: 1, ...c, intent: "for_you" });                       // an old cursor means "for you"
    expect(decodeCursor(encodeCursor({ ...c, intent: "planning" }))!.intent).toBe("planning");        // a scroll keeps the mode it began in
    expect(decodeCursor(Buffer.from(JSON.stringify({ v: 1, ids: [], seen: [], gen: 0, intent: "hack" })).toString("base64url"))).toBeNull();
  });
  it("treats garbage, tampering, oversize and wrong shapes as 'no cursor' instead of failing", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("%%%")).toBeNull();
    expect(decodeCursor(Buffer.from('{"v":1,"ids":["x"],"seen":[],"gen":0}').toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from('{"v":2,"ids":[],"seen":[],"gen":0}').toString("base64url"))).toBeNull();
    expect(decodeCursor("a".repeat(30_000))).toBeNull();
    expect(decodeCursor(encodeCursor({ ids: Array.from({ length: 500 }, (_, i) => uid(i)), seen: [], gen: 0 }))).toBeNull();
  });
});
