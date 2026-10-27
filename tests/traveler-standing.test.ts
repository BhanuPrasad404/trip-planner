import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { badgeOf, LOCAL_VOICE_AT, nextStep, tierFor, TIERS, toStanding, type StandingRow } from "@/lib/social/standing";
import { forgetStanding, loadStanding } from "@/lib/server/standing";
import { buildQuickReport, markAsked, muteAsking, quickCaption, shouldAsk } from "@/lib/feed/quick-report";
import { ESTIMATED_HEIGHT, loadHeights, saveHeights, shouldDraw } from "@/lib/client/feed-snapshot";

const row = (o: Partial<StandingRow> = {}): StandingRow => ({ author_id: "a1", helped: 0, posts: 0, followers: 3, following: 2, top_destination_id: null, top_destination_name: null, top_destination_helped: 0, ...o });

describe("badges", () => {
  it("each step is earned exactly at its number, and the top is rare", () => {
    expect(tierFor(0)).toBeNull(); expect(tierFor(4)).toBeNull();
    expect(tierFor(5)?.id).toBe("helpful"); expect(tierFor(24)?.id).toBe("helpful");
    expect(tierFor(25)?.id).toBe("trusted"); expect(tierFor(100)?.id).toBe("guide"); expect(tierFor(499)?.id).toBe("guide"); expect(tierFor(500)?.id).toBe("legend");
    expect(TIERS.map((t) => t.at)).toEqual([...TIERS.map((t) => t.at)].sort((a, b) => a - b));     // in order
  });
  it("the next goal says how far away it is, and stops at the top", () => {
    expect(nextStep(0)).toMatchObject({ tier: { id: "helpful" }, remaining: 5, progress: 0 });
    expect(nextStep(15)).toMatchObject({ tier: { id: "trusted" }, remaining: 10, progress: 0.5 });
    expect(nextStep(500)).toBeNull();
  });
  it("a place badge needs enough travelers helped THERE", () => {
    expect(toStanding(row({ helped: 30, top_destination_id: "d", top_destination_name: "Araku Valley", top_destination_helped: LOCAL_VOICE_AT })).place).toMatchObject({ name: "Araku Valley" });
    expect(toStanding(row({ helped: 30, top_destination_id: "d", top_destination_name: "Araku Valley", top_destination_helped: LOCAL_VOICE_AT - 1 })).place).toBeNull();
  });
  it("reads numbers safely (strings from the database, nulls, nonsense) and keeps hidden follow counts hidden", () => {
    expect(toStanding(row({ helped: "26", posts: "4" }))).toMatchObject({ helped: 26, posts: 4, tier: "trusted" });
    expect(toStanding(row({ helped: -3, posts: null }))).toMatchObject({ helped: 0, posts: 0, tier: null });
    expect(toStanding(row({ followers: null, following: null }))).toMatchObject({ followers: null, following: null });
  });
  it("a card only carries a badge when there is one", () => {
    expect(badgeOf(toStanding(row({ helped: 2 })))).toBeNull();
    expect(badgeOf(toStanding(row({ helped: 6 })))).toEqual({ tier: "helpful", place: null, helped: 6 });
    expect(badgeOf(null)).toBeNull();
  });
});

describe("standing on the server: one call per page, a short memory, and no leaks between viewers", () => {
  const calls: unknown[] = [];
  let rows: StandingRow[] = [];
  let fail = false;
  const supabase = { rpc: async (_fn: string, args: { _authors: string[] }) => { calls.push(args._authors); return fail ? { data: null, error: { code: "XX", message: "boom" } } : { data: rows.filter((r) => args._authors.includes(r.author_id)), error: null }; } } as unknown as SupabaseClient;
  beforeEach(() => { forgetStanding(); calls.length = 0; rows = [row({ author_id: "a1", helped: 30 }), row({ author_id: "a2", helped: 1 })]; fail = false; vi.spyOn(console, "error").mockImplementation(() => undefined); });

  it("asks once for the whole page, then remembers for a few minutes", async () => {
    const first = await loadStanding(supabase, ["a1", "a2", "a1"], { now: 1000 });
    expect(first.get("a1")?.tier).toBe("trusted"); expect(calls).toEqual([["a1", "a2"]]);
    await loadStanding(supabase, ["a1", "a2"], { now: 2000 });
    expect(calls).toHaveLength(1);
    await loadStanding(supabase, ["a1"], { now: 1000 + 6 * 60_000 });
    expect(calls).toHaveLength(2);
  });
  it("NEVER shares follower numbers between viewers: the shared memory has none, a profile page reads them fresh", async () => {
    const owner = await loadStanding(supabase, ["a1"], { now: 1000, withFollows: true });
    expect(owner.get("a1")?.followers).toBe(3);
    const stranger = await loadStanding(supabase, ["a1"], { now: 2000 });
    expect(stranger.get("a1")?.followers).toBeNull();
    expect(calls).toHaveLength(1);                                              // served from memory, without the numbers
  });
  it("a failure costs the badges, never the posts", async () => {
    fail = true;
    expect((await loadStanding(supabase, ["a1"], { now: 1 })).size).toBe(0);
  });
});

describe("'How was it?' after a stop", () => {
  const place = { name: "Echo Point", lat: 18.98, lng: 73.26 };
  it("needs one tap or a few words, and says so", () => {
    expect(buildQuickReport({ place, crowd: null, conditions: [], note: " ", device: null })).toEqual({ ok: false, reason: "Tap one thing, or write a few words." });
    expect(buildQuickReport({ place, crowd: "quiet", conditions: [], note: "", device: null }).ok).toBe(true);
    expect(buildQuickReport({ place, crowd: null, conditions: [], note: "Go early", device: null }).ok).toBe(true);
  });
  it("its words are only what was tapped or typed", () => {
    expect(quickCaption("quiet", ["road_good", "parking_full"])).toBe("Crowd: quiet. Road is good. Parking full.");
    const r = buildQuickReport({ place, crowd: "crowded", conditions: ["long_queue", "long_queue", "volcano"], note: "", device: { lat: 18.9, lng: 73.2 } });
    expect(r.ok && r.body).toMatchObject({ kind: "report", caption: "Crowd: crowded. Long queue.", conditions: ["long_queue"], place_name: "Echo Point", location_precision: "approx", device_lat: 18.9, media: [] });
    const typed = buildQuickReport({ place, crowd: "quiet", conditions: [], note: "  Clear view by 10  ", device: null });
    expect(typed.ok && typed.body.caption).toBe("Clear view by 10");
  });
  it("a stop without a real place is not posted", () => {
    expect(buildQuickReport({ place: { name: "x", lat: 1, lng: 2 }, crowd: "quiet", conditions: [], note: "", device: null }).ok).toBe(false);
    expect(buildQuickReport({ place: { name: "Echo", lat: Number.NaN, lng: 2 }, crowd: "quiet", conditions: [], note: "", device: null }).ok).toBe(false);
  });
  it("asks once per stop, never after 'Don't ask', and stays silent when storage fails", () => {
    const m = new Map<string, string>(); const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(shouldAsk(store, "p1")).toBe(true); markAsked(store, "p1");
    expect(shouldAsk(store, "p1")).toBe(false); expect(shouldAsk(store, "p2")).toBe(true);
    muteAsking(store); expect(shouldAsk(store, "p2")).toBe(false);
    expect(shouldAsk(null, "p3")).toBe(false);
    expect(shouldAsk({ getItem: () => { throw new Error("blocked"); }, setItem: () => undefined }, "p3")).toBe(false);
    m.set("trailmate.quick.asked.v1", "not json"); m.delete("trailmate.quick.muted.v1");
    expect(shouldAsk(store, "p9")).toBe(false);
  });
  it("remembers at most 200 stops", () => {
    const m = new Map<string, string>(); const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    for (let i = 0; i < 250; i++) markAsked(store, `p${i}`);
    expect(JSON.parse(m.get("trailmate.quick.asked.v1")!)).toHaveLength(200);
    expect(shouldAsk(store, "p0")).toBe(true); expect(shouldAsk(store, "p249")).toBe(false);
  });
});

describe("windowed scrolling", () => {
  it("the first posts are always drawn; the rest only when near the screen", () => {
    const near = new Set(["x"]);
    expect([0, 1, 2].map((i) => shouldDraw(i, `id${i}`, near))).toEqual([true, true, true]);
    expect(shouldDraw(10, "y", near)).toBe(false); expect(shouldDraw(10, "x", near)).toBe(true);
  });
  it("post heights are remembered for Back, and damaged values are ignored", () => {
    const m = new Map<string, string>(); const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    saveHeights(store, new Map([["a", 812.4], ["b", -5], ["c", Number.NaN], ["d", 99_999]]));
    expect([...loadHeights(store)]).toEqual([["a", 812]]);
    m.set("trailmate.feed.heights.v1", "[1,2]"); expect(loadHeights(store).size).toBe(0);
    m.set("trailmate.feed.heights.v1", "{bad"); expect(loadHeights(store).size).toBe(0);
    expect(ESTIMATED_HEIGHT).toBeGreaterThan(300);
  });
});
