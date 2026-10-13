// AUDIT PROBE (read-only audit): each test asserts the behaviour that was observed, so a green run PROVES the defect/property.
import { describe, expect, it } from "vitest";
import { rankFeed, type RankInput } from "@/lib/feed/rank";
import { engagementQuality, freshness } from "@/lib/feed/scoring";
import { effectiveTime } from "@/lib/social/freshness";
import { decodeCursor, encodeCursor } from "@/lib/feed/cursor";
import type { FeedCandidate } from "@/lib/feed/types";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let seq = 1;
const cand = (o: Omit<Partial<FeedCandidate>, "counters"> & { hours?: number; counters?: Partial<FeedCandidate["counters"]> } = {}): FeedCandidate => {
  const { hours = 6, counters, ...rest } = o;
  const n = seq++;
  return {
    id: uid(n), authorId: uid(1000 + n), username: `u${n}`, displayName: null,
    destinationId: uid(2000 + n), destinationName: `D${n}`, destinationSlug: `d${n}`, destinationPosts: 5,
    kind: "photo", caption: null, placeName: `P${n}`, lat: 18.98, lng: 73.26, locationPrecision: "approx",
    capturedAt: ago(hours), createdAt: ago(hours), commentsAllowed: "everyone", durationS: null,
    counters: { likes: 0, comments: 0, saves: 0, shares: 0, helpful: 0, tripAdds: 0, impressions: 0, plays: 0, completions: 0, skips: 0, watchMs: 0, ...counters },
    crowd: null, conditions: [], vibes: [], tip: null, fromArea: false, helped: false,
    pools: ["fresh"], followed: false, liked: false, saved: false, seenAt: null, seenPct: null, ...rest,
  };
};
const input = (o: Partial<RankInput> = {}): RankInput => ({ nowMs: NOW, userId: uid(9), tripDestinationIds: new Set(), affinity: new Map(), interests: [], position: null, seed: "s", ...o });

describe("audit52: pagination boundary", () => {
  it("diversity is NOT carried across a refill snapshot: same destination run / same creator repeat at the seam", () => {
    // 14 posts at destination X (distinct creators, strong), 6 at Y (weaker). Service ranks snapshot 1, then re-ranks with exclude=seen.
    const X = uid(7001), Y = uid(7002);
    const xs = Array.from({ length: 14 }, (_, i) => cand({ destinationId: X, hours: 1 + i * 0.1, counters: { likes: 30, impressions: 60 } }));
    const ys = Array.from({ length: 6 }, () => cand({ destinationId: Y, hours: 40, counters: { likes: 1, impressions: 60 } }));
    const all = [...xs, ...ys];
    let worst = 0;
    for (const n of [3, 4, 5, 6, 7, 8, 9, 10]) {
      const s1 = rankFeed(all, input(), { n });
      const s2 = rankFeed(all, input(), { n, exclude: new Set(s1.map((r) => r.candidate.id)) });
      const seam = [...s1, ...s2].map((r) => r.candidate.destinationId);
      let run = 1, max = 1;
      for (let i = 1; i < seam.length; i++) { run = seam[i] === seam[i - 1] ? run + 1 : 1; max = Math.max(max, run); }
      worst = Math.max(worst, max);
    }
    // within one snapshot the hard cap is 2 (DIVERSITY.destinationMaxRun) while Y posts exist; across the seam it is exceeded
    expect(worst).toBeGreaterThan(2);
  });

  it("same creator can end page-snapshot 1 and start snapshot 2 back to back (creatorHardGap not enforced at the seam)", () => {
    const A = uid(8001);
    const posts = [
      ...Array.from({ length: 6 }, () => cand({ authorId: A, hours: 1, counters: { likes: 40, impressions: 60 } })),
      ...Array.from({ length: 10 }, () => cand({ hours: 30, counters: { likes: 1, impressions: 60 } })),
    ];
    let hit = false;
    for (let n = 2; n <= 12 && !hit; n++) {
      const s1 = rankFeed(posts, input(), { n });
      const s2 = rankFeed(posts, input(), { n, exclude: new Set(s1.map((r) => r.candidate.id)) });
      if (s1.length && s2.length && s1[s1.length - 1].candidate.authorId === A && s2[0].candidate.authorId === A) hit = true;
    }
    expect(hit).toBe(true);
  });

  it("cursor is unsigned and not bound to a user/intent-checked: any well-formed JSON with any uuids is accepted", () => {
    const forged = encodeCursor({ ids: [uid(1), uid(2)], seen: [], gen: 999, intent: "for_you" });
    expect(decodeCursor(forged)?.ids).toEqual([uid(1), uid(2)]);   // safe only because feed_items re-applies RLS
  });
});

describe("audit52: ranking / engagement", () => {
  it("self-engagement: 40 comments by the author's own account (no cap, comments weigh x3) outrank genuine organic engagement", () => {
    const rigged = cand({ hours: 2, counters: { comments: 40, impressions: 10 } });                 // the author commenting on their own post
    const organic = cand({ hours: 2, counters: { likes: 12, saves: 4, impressions: 150 } });         // real, broader audience
    expect(engagementQuality(rigged)).toBeGreaterThan(engagementQuality(organic));
    const r = rankFeed([organic, rigged], input());
    expect(r[0].candidate.id).toBe(rigged.id);
  });

  it("stale 'conditions' report with heavy historic engagement does NOT beat a fresh low-engagement post (verified correct)", () => {
    const stale = cand({ kind: "report", hours: 24 * 20, conditions: ["road_bad", "closed"], tip: "Road closed past km 12", counters: { likes: 300, saves: 80, comments: 40, impressions: 800 } });
    const fresh = cand({ kind: "photo", hours: 3, counters: { likes: 1, impressions: 20 } });
    const r = rankFeed([fresh, stale], input());
    expect(freshness(stale, NOW)).toBeLessThan(0.02 + 1e-3);          // freshness already at its floor (20 d on a 48 h half-life)
    expect(r[0].candidate.id).toBe(fresh.id);
  });

  it("brand-new post with zero history is not buried (exploration + prior): scores above an old, mildly engaged post", () => {
    const brandNew = cand({ hours: 0.1 });
    const old = cand({ hours: 24 * 30, counters: { likes: 5, impressions: 100 } });
    expect(rankFeed([old, brandNew], input())[0].candidate.id).toBe(brandNew.id);
  });
});

describe("audit52: device clock / capture date", () => {
  it("a future captured_at never makes a post fresher (verified correct)", () => {
    const created = ago(48);
    expect(effectiveTime(created, new Date(NOW + 5 * 86_400_000).toISOString(), new Date(NOW)).toISOString()).toBe(created);
  });
  it("a post claiming a year-2000 capture date is accepted and just looks old; no lower bound exists (zod datetime only)", async () => {
    const { createPostSchema } = await import("@/lib/social/schemas");
    const r = createPostSchema.safeParse({ kind: "report", caption: "x", place_name: "Fort", lat: 1, lng: 1, captured_at: "0001-01-01T00:00:00Z", media: [] });
    expect(r.success).toBe(true);
    const r2 = createPostSchema.safeParse({ kind: "report", caption: "x", place_name: "Fort", lat: 1, lng: 1, captured_at: "2999-01-01T00:00:00Z", media: [] });
    expect(r2.success).toBe(true);                                      // future date passes the API; only the DB trigger clamps it
  });
  it("'Just now' is trusted blindly: an old photo posted with no captured_at is 'fresh' / usableAsCurrent", async () => {
    const { freshnessOf } = await import("@/lib/social/freshness");
    expect(freshnessOf(ago(0.01), null, new Date(NOW)).usableAsCurrent).toBe(true);
  });
});
