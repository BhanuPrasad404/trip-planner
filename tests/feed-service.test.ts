import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFeedPage, FeedError } from "@/lib/server/feed-service";
import { decodeCursor, encodeCursor } from "@/lib/feed/cursor";
import { rowToCandidate, toItem, type FeedRow } from "@/lib/feed/map";
import type { MediaStorage } from "@/lib/social/storage";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const row = (n: number, o: Partial<FeedRow> = {}): FeedRow => ({
  pools: ["fresh"], id: uid(n), author_id: uid(500 + n), username: `trav${n}`, display_name: null,
  destination_id: uid(900 + n), destination_name: `Dest ${n}`, destination_slug: `dest-${n}`, destination_posts: 3,
  kind: "photo", caption: `post ${n}`, place_name: `Spot ${n}`, lat: 18.98, lng: 73.26, location_precision: "approx",
  captured_at: ago(n), created_at: ago(n), comments_allowed: "everyone", duration_s: null,
  crowd: null, conditions: [], vibes: [], tip: null, verified_area: false, helped: false, helpful: 0, trip_adds: 0,
  likes: 2, comments: 0, saves: 0, shares: 0, impressions: 50, plays: 0, completions: 0, skips: 0, watch_ms: 0,
  followed: false, liked: false, saved: false, seen_at: null, seen_pct: null, ...o,
});

type World = { candidates: FeedRow[]; items: FeedRow[]; media: unknown[]; rpcCalls: { fn: string; args: Record<string, unknown> }[]; fail: Set<string>; affinity: unknown[]; interests: string[]; stops: unknown[]; near: string[] };
const w: World = { candidates: [], items: [], media: [], rpcCalls: [], fail: new Set(), affinity: [], interests: [], stops: [], near: [] };

function builder(table: string) {
  const b: Record<string, unknown> = {};
  const result = () => {
    if (table === "post_media") return w.fail.has("media") ? { data: null, error: { code: "XX", message: "boom" } } : { data: w.media, error: null };
    if (table === "places") return { data: w.stops, error: null };
    if (table === "profiles") return { data: { interests: w.interests }, error: null };
    return { data: [], error: null };
  };
  Object.assign(b, { select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b, maybeSingle: async () => result(), then: (res: (v: unknown) => unknown) => res(result()) });
  return b;
}
const supabase = {
  rpc: async (fn: string, args: Record<string, unknown>) => {
    w.rpcCalls.push({ fn, args });
    if (w.fail.has(fn)) return { data: null, error: { code: "XX", message: "boom" } };
    if (fn === "feed_candidates") return { data: w.candidates, error: null };
    if (fn === "feed_items") { const ids = args._ids as string[]; return { data: w.items.filter((r) => ids.includes(r.id)), error: null }; }
    if (fn === "user_destination_affinity") return { data: w.affinity, error: null };
    if (fn === "destinations_near_points") return { data: w.near, error: null };
    return { data: null, error: null };
  },
  from: (t: string) => builder(t),
} as unknown as SupabaseClient;
const storage: MediaStorage = {
  createUploadTarget: async () => null, allExist: async () => true, remove: async () => undefined, readBytes: async () => null,
  signedUrls: async (paths) => new Map(paths.map((p) => [p, `https://signed.example/${p}`])),
};
const deps = { now: () => NOW, storage };
const me = uid(1);

beforeEach(() => { Object.assign(w, { candidates: [], items: [], media: [], rpcCalls: [], fail: new Set(), affinity: [], interests: [], stops: [], near: [] }); vi.spyOn(console, "info").mockImplementation(() => undefined); vi.spyOn(console, "error").mockImplementation(() => undefined); });

describe("row → candidate → item", () => {
  it("rejects malformed rows instead of letting them reach the ranker", () => {
    expect(rowToCandidate(row(1, { kind: "story" }))).toBeNull();
    expect(rowToCandidate(row(1, { destination_id: "" }))).toBeNull();
    expect(rowToCandidate(row(1, { duration_s: "12.5", watch_ms: "9000", likes: Number.NaN }))?.counters).toMatchObject({ watchMs: 9000, likes: 0 });
  });
  it("the screen payload has no scores or pool names, and says honestly how fresh a post is", () => {
    const c = rowToCandidate(row(3, { created_at: ago(3), captured_at: ago(3) }))!;
    const item = toItem(c, [], { now: new Date(NOW), viewerId: me, position: { lat: 18.98, lng: 73.26 } });
    expect(JSON.stringify(item)).not.toMatch(/score|pools|impressions|watch/i);
    expect(item.freshness).toMatchObject({ dot: "green", usableAsCurrent: true });
    expect(item.location.distanceKm).toBe(0);
    expect(toItem(c, [], { now: new Date(NOW), viewerId: me, position: null }).location.distanceKm).toBeNull();
    const old = rowToCandidate(row(3, { created_at: ago(24 * 100), captured_at: ago(24 * 100) }))!;
    expect(toItem(old, [], { now: new Date(NOW), viewerId: me, position: null }).freshness.usableAsCurrent).toBe(false);
  });
  it("comment permission respects 'followers only' and 'off'", () => {
    const opts = { now: new Date(NOW), viewerId: me, position: null };
    expect(toItem(rowToCandidate(row(1, { comments_allowed: "off" }))!, [], opts).canComment).toBe(false);
    expect(toItem(rowToCandidate(row(1, { comments_allowed: "followers", followed: false }))!, [], opts).canComment).toBe(false);
    expect(toItem(rowToCandidate(row(1, { comments_allowed: "followers", followed: true }))!, [], opts).canComment).toBe(true);
  });
});

describe("buildFeedPage — first page", () => {
  it("ranks the candidates, returns one page, signs media once, and hands back the rest in the cursor", async () => {
    w.candidates = Array.from({ length: 20 }, (_, i) => row(i + 2));
    w.media = [{ post_id: uid(2), position: 0, media_type: "image", storage_path: `${me}/a.jpg`, poster_path: null, width: 1080, height: 1350, duration_s: null }];
    const page = await buildFeedPage(supabase, me, { limit: 8 }, deps);
    expect(page.items).toHaveLength(8);
    expect(new Set(page.items.map((i) => i.id)).size).toBe(8);
    expect(page.coldStart).toBe(true);
    const cur = decodeCursor(page.nextCursor)!;
    expect(cur.ids).toHaveLength(12);
    expect(cur.seen).toHaveLength(8);
    expect(cur.ids.some((id) => page.items.some((i) => i.id === id))).toBe(false);
    const withMedia = page.items.find((i) => i.id === uid(2));
    if (withMedia) expect(withMedia.media[0]).toMatchObject({ type: "image", url: `https://signed.example/${me}/a.jpg`, width: 1080 });
    expect(w.rpcCalls.filter((c) => c.fn === "feed_candidates")).toHaveLength(1);        // one candidate query per snapshot
  });

  it("uses the trip's stops, my likes and my interests as signals, and is no longer 'cold'", async () => {
    w.stops = [{ lat: 18.98, lng: 73.26 }]; w.near = [uid(902)]; w.affinity = [{ destination_id: uid(903), score: 3 }]; w.interests = ["Waterfall"];
    w.candidates = [row(2), row(3), row(4)];
    const page = await buildFeedPage(supabase, me, { tripId: uid(77) }, deps);
    expect(page.coldStart).toBe(false);
    const q = w.rpcCalls.find((c) => c.fn === "feed_candidates")!.args;
    expect(q._dest).toEqual(expect.arrayContaining([uid(902), uid(903)]));
    expect(q._lat).toBe(18.98);
  });

  it("a brand-new person with no history still gets content", async () => {
    w.candidates = [row(2), row(3)];
    const page = await buildFeedPage(supabase, me, {}, deps);
    expect(page.items.length).toBe(2);
    expect(page.coldStart).toBe(true);
  });

  it("an empty database ends the feed (no cursor) instead of spinning", async () => {
    const page = await buildFeedPage(supabase, me, {}, deps);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("degrades gracefully: failing personal signals or media never break the feed", async () => {
    w.candidates = [row(2), row(3)]; w.fail = new Set(["user_destination_affinity", "destinations_near_points", "media"]); w.stops = [{ lat: 1, lng: 1 }];
    const page = await buildFeedPage(supabase, me, { tripId: uid(77) }, deps);
    expect(page.items).toHaveLength(2);
    expect(page.items.every((i) => i.media.length === 0)).toBe(true);
  });

  it("but a failed candidate query is a real error the route can report", async () => {
    w.fail = new Set(["feed_candidates"]);
    await expect(buildFeedPage(supabase, me, {}, deps)).rejects.toBeInstanceOf(FeedError);
  });

  it("skips malformed rows rather than crashing", async () => {
    w.candidates = [row(2), row(3, { kind: "weird" })];
    expect((await buildFeedPage(supabase, me, {}, deps)).items.map((i) => i.id)).toEqual([uid(2)]);
  });

  it("clamps a silly limit", async () => {
    w.candidates = Array.from({ length: 30 }, (_, i) => row(i + 2));
    expect((await buildFeedPage(supabase, me, { limit: 9999 }, deps)).items.length).toBeLessThanOrEqual(12);
    expect((await buildFeedPage(supabase, me, { limit: -4 }, deps)).items.length).toBe(1);
  });
});

describe("buildFeedPage — scrolling on", () => {
  it("continues the same snapshot in the same order, and drops posts that vanished meanwhile", async () => {
    const all = Array.from({ length: 10 }, (_, i) => row(i + 2));
    w.items = all.filter((r) => r.id !== uid(4));                    // post 4 was deleted since the snapshot
    const cursor = encodeCursor({ ids: all.map((r) => r.id), seen: [], gen: 0 });
    const page = await buildFeedPage(supabase, me, { cursor, limit: 4 }, deps);
    expect(page.items.map((i) => i.id)).toEqual([uid(2), uid(3), uid(5)]);
    expect(decodeCursor(page.nextCursor)!.ids).toEqual(all.slice(4).map((r) => r.id));
    expect(w.rpcCalls.map((c) => c.fn)).not.toContain("feed_candidates");        // no re-ranking mid-snapshot
  });

  it("when the snapshot is used up it re-ranks WITHOUT repeating what was just shown", async () => {
    w.candidates = Array.from({ length: 6 }, (_, i) => row(i + 2));
    const first = await buildFeedPage(supabase, me, { limit: 6 }, deps);
    expect(first.items).toHaveLength(6);
    const refill = decodeCursor(first.nextCursor)!;
    expect(refill.ids).toEqual([]);                                  // "refill next time"
    w.candidates = [...w.candidates, row(20), row(21)];
    const second = await buildFeedPage(supabase, me, { cursor: first.nextCursor, limit: 6 }, deps);
    expect(second.items.map((i) => i.id).sort()).toEqual([uid(20), uid(21)]);
    expect(decodeCursor(second.nextCursor)!.gen).toBe(1);
  });

  it("reaching the end of everything is a clean stop", async () => {
    w.candidates = [row(2), row(3)];
    const first = await buildFeedPage(supabase, me, { limit: 8 }, deps);
    const end = await buildFeedPage(supabase, me, { cursor: first.nextCursor, limit: 8 }, deps);
    expect(end.items).toEqual([]);
    expect(end.nextCursor).toBeNull();
  });

  it("a tampered or garbage cursor just starts a fresh feed", async () => {
    w.candidates = [row(2)];
    const page = await buildFeedPage(supabase, me, { cursor: "not-a-cursor" }, deps);
    expect(page.items).toHaveLength(1);
  });

  it("a forged cursor cannot reveal anything: ids still go through the database's visibility rules", async () => {
    const stranger = uid(999);                                       // private post: feed_items returns nothing for it
    const cursor = encodeCursor({ ids: [stranger], seen: [], gen: 0 });
    const page = await buildFeedPage(supabase, me, { cursor }, deps);
    expect(page.items).toEqual([]);
  });
});

describe("buildFeedPage — modes", () => {
  it("'My trip' with no places on the trip says WHY it is empty instead of showing an unexplained blank", async () => {
    w.candidates = [row(2), row(3)];
    const noTrip = await buildFeedPage(supabase, me, { intent: "trip" }, deps);
    expect(noTrip.items).toEqual([]); expect(noTrip.nextCursor).toBeNull(); expect(noTrip.notice).toMatch(/Open a trip/);
    w.stops = [{ lat: 18.98, lng: 73.26 }]; w.near = [];
    const emptyTrip = await buildFeedPage(supabase, me, { intent: "trip", tripId: uid(77) }, deps);
    expect(emptyTrip.notice).toMatch(/No travelers have posted/);
    expect(w.rpcCalls.some((c) => c.fn === "feed_candidates")).toBe(false);                 // nothing to look up, so nothing was asked
  });
  it("'My trip' asks only for the trip's destinations; other modes also include places you have engaged with", async () => {
    w.stops = [{ lat: 18.98, lng: 73.26 }]; w.near = [uid(902)]; w.affinity = [{ destination_id: uid(903), score: 3 }]; w.candidates = [row(2, { destination_id: uid(902) })];
    await buildFeedPage(supabase, me, { intent: "trip", tripId: uid(77) }, deps);
    expect(w.rpcCalls.find((c) => c.fn === "feed_candidates")!.args._dest).toEqual([uid(902)]);
    w.rpcCalls = [];
    await buildFeedPage(supabase, me, { intent: "planning", tripId: uid(77) }, deps);
    expect(w.rpcCalls.find((c) => c.fn === "feed_candidates")!.args._dest).toEqual(expect.arrayContaining([uid(902), uid(903)]));
  });
  it("a scroll keeps the mode it started in, even if a later request says otherwise", async () => {
    w.candidates = Array.from({ length: 20 }, (_, i) => row(i + 2));
    const first = await buildFeedPage(supabase, me, { intent: "planning", limit: 8 }, deps);
    expect(decodeCursor(first.nextCursor)!.intent).toBe("planning");
    w.items = w.candidates;
    const second = await buildFeedPage(supabase, me, { cursor: first.nextCursor, intent: "gems", limit: 8 }, deps);
    expect(decodeCursor(second.nextCursor)!.intent).toBe("planning");
  });
  it("'Right now' leaves out posts older than a week", async () => {
    w.candidates = [row(2, { created_at: ago(5), captured_at: ago(5) }), row(3, { created_at: ago(24 * 20), captured_at: ago(24 * 20) })];
    const page = await buildFeedPage(supabase, me, { intent: "now" }, deps);
    expect(page.items.map((i) => i.id)).toEqual([uid(2)]);
  });
  it("carries what travelers said about the place all the way to the screen payload", async () => {
    w.candidates = [row(2, { crowd: "quiet", conditions: ["foggy", "volcano"], vibes: ["best_view"], tip: "Go early", verified_area: true, helpful: 4, trip_adds: 2, helped: true })];
    const it = (await buildFeedPage(supabase, me, {}, deps)).items[0];
    expect(it.experience).toEqual({ crowd: "quiet", conditions: ["foggy"], vibes: ["best_view"], tip: "Go early", fromArea: true });      // an unknown condition never reaches the screen
    expect(it.counts).toMatchObject({ helpful: 4, tripAdds: 2 }); expect(it.me.helped).toBe(true);
  });
});

