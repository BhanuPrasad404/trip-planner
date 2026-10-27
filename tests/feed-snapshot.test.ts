import { describe, expect, it } from "vitest";
import { LINKS_SAFE_MS, loadSnapshot, saveSnapshot, snapshotKey, SNAPSHOT_MAX_CHARS, SNAPSHOT_TTL_MS, updateSnapshot, type Snapshot } from "@/lib/client/feed-snapshot";
import { feedReducer, initialFeed } from "@/lib/client/feed-state";
import { sendReaction, serverCount, withReaction } from "@/lib/client/reactions";
import type { FeedItemDTO } from "@/lib/feed/map";

const item = (n: number, o: Partial<FeedItemDTO> = {}): FeedItemDTO => ({
  id: `2222222${n}-2222-4222-8222-222222222222`, kind: "photo", caption: "c", placeName: "Spot", destination: { id: `d${n}`, name: "Matheran", slug: "m" }, author: { username: "ravi", displayName: null }, media: [],
  counts: { likes: 1, comments: 0, saves: 0, helpful: 0, tripAdds: 0 }, me: { liked: false, saved: false, helped: false }, experience: { crowd: null, conditions: [], vibes: [], tip: null, fromArea: false },
  freshness: { label: "now", state: "fresh", dot: "green", usableAsCurrent: true }, location: { lat: 1, lng: 2, precision: "approx", distanceKm: null }, canComment: true, isMine: false, createdAt: "2026-10-10T10:00:00Z", ...o,
});
const fake = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ key: snapshotKey("t1", "for_you"), savedAt: 1_000_000, items: [item(1), item(2)], nextCursor: "c", coldStart: false, notice: null, tripDestinations: ["d1"], scrollY: 1234, fetchedAt: 1_000_000, ...o });
const KEY = snapshotKey("t1", "for_you");

describe("the feed is remembered for Back", () => {
  it("brings back the same posts at the same place", () => {
    const s = fake(); expect(saveSnapshot(s, snap())).toBe(true);
    const back = loadSnapshot(s, KEY, 1_000_000 + 60_000)!;
    expect(back.items.map((i) => i.id)).toEqual(snap().items.map((i) => i.id));
    expect(back.scrollY).toBe(1234); expect(back.nextCursor).toBe("c"); expect(back.tripDestinations).toEqual(["d1"]);
  });
  it("NEVER brings back a feed whose picture links may have expired, even if it was saved a moment ago (the black-video bug)", () => {
    const s = fake();
    const now = 1_000_000 + LINKS_SAFE_MS + 60_000;
    saveSnapshot(s, snap({ savedAt: now - 5_000, fetchedAt: 1_000_000 }));          // scrolled 5 s ago, but the posts were fetched 41 min ago
    expect(loadSnapshot(s, KEY, now)).toBeNull();
    saveSnapshot(s, snap({ savedAt: now - 5_000, fetchedAt: now - 10 * 60_000 }));  // fetched 10 min ago: fine
    expect(loadSnapshot(s, KEY, now)).not.toBeNull();
    const old = { ...snap({ savedAt: now - 5_000 }) } as Partial<Snapshot>; delete old.fetchedAt;  // saved by the previous version, which had no fetch time
    s.setItem("trailmate.feed.snapshot.v1", JSON.stringify(old));
    expect(loadSnapshot(s, KEY, now)).toBeNull();
  });
  it("forgets after fifteen minutes, and for another trip or mode", () => {
    const s = fake(); saveSnapshot(s, snap());
    expect(loadSnapshot(s, KEY, 1_000_000 + SNAPSHOT_TTL_MS + 1)).toBeNull();
    saveSnapshot(s, snap());
    expect(loadSnapshot(s, snapshotKey("t2", "for_you"), 1_000_001)).toBeNull();
    saveSnapshot(s, snap());
    expect(loadSnapshot(s, snapshotKey("t1", "now"), 1_000_001)).toBeNull();
    expect(loadSnapshot(s, KEY, 1_000_001)).toBeNull();                              // and a rejected snapshot is deleted, not kept
  });
  it("never trusts damaged or odd storage", () => {
    for (const bad of ["not json", "{}", JSON.stringify({ ...snap(), items: [{ id: 1 }] }), JSON.stringify({ ...snap(), scrollY: "far" }), JSON.stringify({ ...snap(), savedAt: 9_999_999_999 })]) {
      const s = fake(); s.setItem("trailmate.feed.snapshot.v1", bad);
      expect(loadSnapshot(s, KEY, 1_000_001)).toBeNull();
    }
    const broken = { getItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(loadSnapshot(broken, KEY, 1)).toBeNull();
    expect(saveSnapshot({ setItem: () => { throw new Error("full"); }, removeItem: () => undefined }, snap())).toBe(false);
  });
  it("an empty feed or a huge one is not kept", () => {
    const s = fake();
    expect(saveSnapshot(s, snap({ items: [] }))).toBe(false);
    expect(saveSnapshot(s, snap({ items: [item(1, { caption: "x".repeat(SNAPSHOT_MAX_CHARS) })] }))).toBe(false);
    expect(s.m.size).toBe(0);
  });
  it("a like or a delete made on the post page shows when the person goes Back", () => {
    const s = fake(); saveSnapshot(s, snap());
    const [a, b] = snap().items;
    updateSnapshot(s, (items) => items.map((i) => (i.id === a.id ? withReaction(i, "like", true) : i)));
    expect(loadSnapshot(s, KEY, 1_000_001)!.items[0].me.liked).toBe(true);
    updateSnapshot(s, (items) => items.filter((i) => i.id !== b.id));
    expect(loadSnapshot(s, KEY, 1_000_001)!.items.map((i) => i.id)).toEqual([a.id]);
    updateSnapshot(s, () => []);
    expect(s.m.size).toBe(0);
    updateSnapshot(s, (i) => i);                                                     // nothing remembered: nothing happens
  });
});

describe("feed state: restore and trip places", () => {
  it("restoring puts the feed back exactly, ready (or at its end)", () => {
    const s = feedReducer(initialFeed, { type: "restore", items: [item(1)], nextCursor: "c", coldStart: false, notice: null, tripDestinations: ["d1"], fetchedAt: 5 });
    expect(s).toMatchObject({ status: "ready", nextCursor: "c", tripDestinations: ["d1"], fetchedAt: 5 });
    expect(feedReducer(initialFeed, { type: "restore", items: [item(1)], nextCursor: null, coldStart: false, notice: null, tripDestinations: [], fetchedAt: 5 }).status).toBe("end");
  });
  it("remembers when the OLDEST page on screen was fetched (later pages don't make old links newer)", () => {
    let s = feedReducer(initialFeed, { type: "loaded", items: [item(1)], nextCursor: "c", coldStart: false, append: false, at: 100 });
    expect(s.fetchedAt).toBe(100);
    s = feedReducer(s, { type: "loaded", items: [item(2)], nextCursor: "d", coldStart: false, append: true, at: 900 });
    expect(s.fetchedAt).toBe(100);
    expect(feedReducer(s, { type: "loaded", items: [item(3)], nextCursor: null, coldStart: false, append: false, at: 2000 }).fetchedAt).toBe(2000);
  });
  it("trip destinations arrive with the first page and survive later pages", () => {
    let s = feedReducer(initialFeed, { type: "loaded", items: [item(1)], nextCursor: "c", coldStart: false, append: false, tripDestinations: ["d9"] });
    s = feedReducer(s, { type: "loaded", items: [item(2)], nextCursor: "c2", coldStart: false, append: true });
    expect(s.tripDestinations).toEqual(["d9"]); expect(s.items).toHaveLength(2);
    expect(feedReducer(s, { type: "load" }).tripDestinations).toEqual([]);
  });
});

describe("reactions", () => {
  it("switch one flag and one count, never below zero", () => {
    const liked = withReaction(item(1), "like", true);
    expect(liked.me.liked).toBe(true); expect(liked.counts.likes).toBe(2);
    expect(withReaction(item(1, { counts: { likes: 0, comments: 0, saves: 0, helpful: 0, tripAdds: 0 } }), "like", false).counts.likes).toBe(0);
    expect(withReaction(item(1), "helpful", true)).toMatchObject({ me: { helped: true }, counts: { helpful: 1 } });
    expect(withReaction(item(1), "save", true, 7).counts.saves).toBe(7);               // the server's number wins
    expect(serverCount("helpful", { likes: 1, saves: 2, helpful: 3 })).toBe(3);
  });
  it("send: plain messages for a missing post, a refusal and a dead connection", async () => {
    const res = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await sendReaction("p", "like", true, res(200, { likes: 5, saves: 0, helpful: 0 }))).toMatchObject({ likes: 5 });
    await expect(sendReaction("p", "like", true, res(404, {}))).rejects.toThrow("isn't available any more");
    await expect(sendReaction("p", "save", true, res(429, { error: "Slow down a little" }))).rejects.toThrow("Slow down a little");
    await expect(sendReaction("p", "save", true, (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)).rejects.toThrow("Couldn't save that. Check your connection.");
  });
});
