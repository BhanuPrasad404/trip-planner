import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTHOR_PAGE, buildFeedPage, loadAuthorPosts, loadPlaceMore, loadPost } from "@/lib/server/feed-service";
import { forgetStanding } from "@/lib/server/standing";
import type { FeedRow } from "@/lib/feed/map";
import type { MediaStorage } from "@/lib/social/storage";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const row = (n: number, o: Partial<FeedRow> = {}): FeedRow => ({
  pools: ["fresh"], id: uid(n), author_id: uid(500 + n), username: `trav${n}`, display_name: null,
  destination_id: uid(900), destination_name: "Matheran", destination_slug: "matheran", destination_posts: 3,
  kind: "photo", caption: `post ${n}`, place_name: `Spot ${n}`, lat: 18.98, lng: 73.26, location_precision: "approx",
  captured_at: ago(n), created_at: ago(n), comments_allowed: "everyone", duration_s: null,
  crowd: null, conditions: [], vibes: [], tip: null, verified_area: false, helped: false, helpful: 0, trip_adds: 0,
  likes: 2, comments: 0, saves: 0, shares: 0, impressions: 50, plays: 0, completions: 0, skips: 0, watch_ms: 0,
  followed: false, liked: false, saved: false, seen_at: null, seen_pct: null, ...o,
});

type World = { items: FeedRow[]; candidates: FeedRow[]; media: unknown[]; calls: { fn: string; args: Record<string, unknown> }[]; fail: Set<string>; stops: unknown[]; near: string[]; posts: { id: string; created_at: string }[]; ors: string[]; standing: unknown[] };
const w: World = { items: [], candidates: [], media: [], calls: [], fail: new Set(), stops: [], near: [], posts: [], ors: [], standing: [] };
function builder(table: string) {
  const b: Record<string, unknown> = {};
  const result = () => (table === "post_media" ? { data: w.media, error: null } : table === "places" ? { data: w.stops, error: null } : table === "profiles" ? { data: { interests: [] }, error: null } : table === "posts" ? (w.fail.has("posts") ? { data: null, error: { code: "XX", message: "boom" } } : { data: w.posts, error: null }) : { data: [], error: null });
  Object.assign(b, { select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b, or: (f: string) => { w.ors.push(f); return b; }, maybeSingle: async () => result(), then: (res: (v: unknown) => unknown) => res(result()) });
  return b;
}
const supabase = {
  rpc: async (fn: string, args: Record<string, unknown>) => {
    w.calls.push({ fn, args });
    if (w.fail.has(fn)) return { data: null, error: { code: "XX", message: "boom" } };
    if (fn === "feed_items") { const ids = args._ids as string[]; return { data: w.items.filter((r) => ids.includes(r.id)), error: null }; }
    if (fn === "feed_candidates") return { data: w.candidates, error: null };
    if (fn === "user_destination_affinity") return { data: [], error: null };
    if (fn === "destinations_near_points") return { data: w.near, error: null };
    if (fn === "traveler_standing") return { data: w.standing, error: null };
    return { data: null, error: null };
  },
  from: (t: string) => builder(t),
} as unknown as SupabaseClient;
const storage: MediaStorage = { createUploadTarget: async () => null, allExist: async () => true, remove: async () => undefined, readBytes: async () => null, signedUrls: async (paths) => new Map(paths.map((p) => [p, `https://signed.example/${p}`])) };
const deps = { now: () => NOW, storage };
const me = uid(1);
beforeEach(() => { forgetStanding(); Object.assign(w, { items: [], candidates: [], media: [], calls: [], fail: new Set(), stops: [], near: [], posts: [], ors: [], standing: [] }); vi.spyOn(console, "info").mockImplementation(() => undefined); vi.spyOn(console, "error").mockImplementation(() => undefined); });

describe("one post for its own page", () => {
  it("is read under the viewer's rules, with its pictures, as the small screen shape", async () => {
    w.items = [row(7, { liked: true, crowd: "quiet", conditions: ["road_good"], tip: "Go early" })];
    w.media = [{ post_id: uid(7), position: 0, media_type: "image", storage_path: "u/a.jpg", poster_path: null, width: 1080, height: 1350, duration_s: null }];
    const post = await loadPost(supabase, me, uid(7), deps);
    expect(post).toMatchObject({ id: uid(7), me: { liked: true }, experience: { crowd: "quiet", tip: "Go early" }, isMine: false });
    expect(post!.media[0].url).toBe("https://signed.example/u/a.jpg");
    expect(w.calls[0]).toEqual({ fn: "feed_items", args: { _ids: [uid(7)] } });
  });
  it("a deleted, hidden, blocked or moderated post is simply not found (the database returns no row)", async () => {
    expect(await loadPost(supabase, me, uid(7), deps)).toBeNull();
  });
  it("a post whose row is damaged is not found rather than broken", async () => {
    w.items = [row(7, { kind: "story" })];
    expect(await loadPost(supabase, me, uid(7), deps)).toBeNull();
  });
  it("a database failure is an error, never a pretend 'not found'", async () => {
    w.fail.add("feed_items");
    await expect(loadPost(supabase, me, uid(7), deps)).rejects.toThrow();
  });
  it("your own post knows it is yours", async () => {
    w.items = [row(7, { author_id: me })];
    expect((await loadPost(supabase, me, uid(7), deps))!.isMine).toBe(true);
  });
});

describe("more from the same destination", () => {
  it("lists only that destination, never the post itself, newest first", async () => {
    w.candidates = [row(5), row(2), row(9, { destination_id: uid(901) }), row(3), row(1)];
    const more = await loadPlaceMore(supabase, me, uid(900), uid(1), 8, deps);
    expect(more.map((m) => m.id)).toEqual([uid(2), uid(3), uid(5)]);                    // 2 h, 3 h, 5 h ago; #9 is another place; #1 is the open post
    expect(w.calls[0]).toMatchObject({ fn: "feed_candidates", args: { _dest: [uid(900)] } });
  });
  it("respects the limit", async () => {
    w.candidates = [row(2), row(3), row(4), row(5)];
    expect(await loadPlaceMore(supabase, me, uid(900), uid(1), 2, deps)).toHaveLength(2);
  });
  it("a failure here never hides the post: it just shows no extras", async () => {
    w.fail.add("feed_candidates");
    expect(await loadPlaceMore(supabase, me, uid(900), uid(1), 8, deps)).toEqual([]);
  });
});

describe("the feed tells the screen which places are on the trip", () => {
  it("the first page carries the destinations near the trip's stops; later pages do not repeat them", async () => {
    w.stops = [{ lat: 18.9, lng: 73.2 }];
    w.near = [uid(900), uid(901)];
    w.candidates = Array.from({ length: 12 }, (_, i) => row(i + 2));
    const first = await buildFeedPage(supabase, me, { tripId: uid(77), limit: 4 }, deps);
    expect(first.tripDestinations).toEqual([uid(900), uid(901)]);
    expect(first.nextCursor).not.toBeNull();
    w.items = w.candidates;
    const second = await buildFeedPage(supabase, me, { cursor: first.nextCursor, tripId: uid(77), limit: 4 }, deps);
    expect(second.tripDestinations).toBeUndefined();
  });
  it("without a trip there are none", async () => {
    w.candidates = [row(2)];
    expect((await buildFeedPage(supabase, me, {}, deps)).tripDestinations).toEqual([]);
  });
});

describe("badges arrive with the posts", () => {
  it("the feed asks for the authors of the page in ONE call and puts each badge on its posts", async () => {
    w.candidates = [row(2, { author_id: uid(70) }), row(3, { author_id: uid(70) }), row(4, { author_id: uid(71) })];
    w.standing = [{ author_id: uid(70), helped: 30, posts: 9, followers: 1, following: 1, top_destination_id: uid(900), top_destination_name: "Matheran", top_destination_helped: 6 }];
    const page = await buildFeedPage(supabase, me, {}, deps);
    expect(w.calls.filter((c) => c.fn === "traveler_standing")).toHaveLength(1);
    const byAuthor = (u: string) => page.items.find((i) => i.author.username === u)!;
    expect(byAuthor("trav2").author.badge).toEqual({ tier: "trusted", place: "Matheran", helped: 30 });
    expect(byAuthor("trav4").author.badge).toBeUndefined();                          // no standing, no badge
  });
});

describe("one traveler's posts", () => {
  const p = (n: number) => ({ id: uid(n), created_at: ago(n) });
  it("newest first, a page at a time, with a cursor only when there is more", async () => {
    w.posts = Array.from({ length: AUTHOR_PAGE + 1 }, (_, i) => p(i + 2));
    w.items = w.posts.map((x, i) => row(i + 2, { id: x.id }));
    const first = await loadAuthorPosts(supabase, me, uid(500), null, deps);
    expect(first.items).toHaveLength(AUTHOR_PAGE);
    expect(first.nextCursor).toBe(`${ago(AUTHOR_PAGE + 1)}|${uid(AUTHOR_PAGE + 1)}`);
    w.posts = [p(30)]; w.items = [row(30)];
    const last = await loadAuthorPosts(supabase, me, uid(500), first.nextCursor, deps);
    expect(last.nextCursor).toBeNull(); expect(w.ors).toHaveLength(1);
  });
  it("a damaged cursor is refused before it reaches the database filter", async () => {
    await expect(loadAuthorPosts(supabase, me, uid(500), "x),or(id.gt.0", deps)).rejects.toMatchObject({ status: 400 });
    expect(w.ors).toHaveLength(0);
  });
  it("no posts, or posts this viewer may not see: an empty page", async () => {
    expect(await loadAuthorPosts(supabase, me, uid(500), null, deps)).toEqual({ items: [], nextCursor: null });
    w.posts = [p(2)];                                                                  // the row exists, but feed_items (RLS) returns nothing
    expect((await loadAuthorPosts(supabase, me, uid(500), null, deps)).items).toEqual([]);
  });
  it("a database failure is an error, not an empty profile", async () => {
    w.fail.add("posts");
    await expect(loadAuthorPosts(supabase, me, uid(500), null, deps)).rejects.toThrow();
  });
});
