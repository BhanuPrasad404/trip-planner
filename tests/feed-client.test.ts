import { describe, expect, it, vi } from "vitest";
import { createEventQueue, type QueuedEvent } from "@/lib/client/feed-events";
import { scrubMp4Location } from "@/lib/client/media-scrub";
import { feedReducer, initialFeed, type FeedState } from "@/lib/client/feed-state";
import type { FeedItemDTO } from "@/lib/feed/map";

const P = "22222222-2222-4222-8222-222222222222";
const Q = "33333333-3333-4333-8333-333333333333";

describe("event queue", () => {
  const make = (send: (e: QueuedEvent[]) => Promise<boolean>, o: object = {}) => createEventQueue({ send: (e) => send(e), setTimer: () => 1, clearTimer: () => undefined, ...o });

  it("sends milestones once per post and batches them into one request", async () => {
    const send = vi.fn(async () => true);
    const q = make(send);
    q.track(P, "impression"); q.track(P, "impression"); q.track(P, "play"); q.track(P, "q25"); q.track(P, "q25"); q.track(Q, "impression");
    await q.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [QueuedEvent[]])[0].map((e) => `${e.post_id.slice(0, 2)}:${e.type}`)).toEqual(["22:impression", "22:play", "22:q25", "33:impression"]);
  });

  it("flushes by itself when a batch is full, never sends more than 50, and clamps watch time", async () => {
    const send = vi.fn(async () => true);
    const q = make(send, { maxBatch: 3 });
    q.track(P, "impression"); q.track(P, "play"); q.track(P, "leave", 999_999);
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [QueuedEvent[]])[0][2].ms).toBe(120_000);
  });

  it("retries a failed batch twice, then gives up quietly", async () => {
    const send = vi.fn(async () => false);
    const q = make(send);
    q.track(P, "impression");
    await q.flush(); expect(q.pending()).toBe(1);
    await q.flush(); expect(q.pending()).toBe(1);
    await q.flush(); expect(q.pending()).toBe(0);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("survives a send that throws, and never runs two flushes at once", async () => {
    let release: (v: boolean) => void = () => undefined;
    const send = vi.fn(() => new Promise<boolean>((r) => { release = r; }));
    const q = make(send);
    q.track(P, "leave", 500);
    const a = q.flush(); const b = q.flush();
    release(true); await a; await b;
    expect(send).toHaveBeenCalledTimes(1);
    const boom = make(async () => { throw new Error("offline"); });
    boom.track(P, "leave", 500);
    await expect(boom.flush()).resolves.toBeUndefined();
  });

  it("is bounded in memory when the network is down for a long time", () => {
    const q = make(async () => false, { maxBatch: 10_000, maxQueue: 50 });
    for (let i = 0; i < 500; i++) q.track(P, "leave", 10);
    expect(q.pending()).toBe(50);
  });

  it("start/stop manage one timer", () => {
    const set = vi.fn(() => 7); const clear = vi.fn();
    const q = createEventQueue({ send: async () => true, setTimer: set, clearTimer: clear });
    q.start(); q.start(); q.stop(); q.stop();
    expect(set).toHaveBeenCalledTimes(1); expect(clear).toHaveBeenCalledTimes(1);
  });
});

describe("scrubMp4Location", () => {
  const box = (type: number[], payload: number[]) => { const size = 8 + payload.length; return [(size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...type, ...payload]; };
  const text = (s: string) => [...s].map((c) => c.charCodeAt(0));

  it("zeroes the GPS text but keeps the box sizes, so the file still plays", () => {
    const gps = text("+18.9867+073.2672/");
    const file = new Uint8Array([...text("ftypisom"), ...box([0x6d, 0x6f, 0x6f, 0x76], box([0xa9, 0x78, 0x79, 0x7a], [0, 18, 0, 0, ...gps])), ...text("mdat-real-video-bytes")]);
    const before = file.length;
    expect(scrubMp4Location(file)).toBe(1);
    expect(file.length).toBe(before);
    expect(new TextDecoder().decode(file)).not.toContain("18.9867");
    expect(new TextDecoder().decode(file)).toContain("mdat-real-video-bytes");
  });

  it("clears 3GPP loci atoms too, leaves ordinary files alone, and ignores coincidental byte patterns", () => {
    const loci = new Uint8Array([...box([0x6c, 0x6f, 0x63, 0x69], text("secret-coordinates"))]);
    expect(scrubMp4Location(loci)).toBe(1);
    expect(new TextDecoder().decode(loci)).not.toContain("secret");
    const plain = new Uint8Array(text("ftypisom....moov....mdat video video video"));
    expect(scrubMp4Location(plain)).toBe(0);
    const coincidence = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xa9, 0x78, 0x79, 0x7a, 1, 2, 3, 4, 5, 6]);   // absurd size in front: not an atom
    expect(scrubMp4Location(coincidence)).toBe(0);
    expect([...coincidence.slice(8)]).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("feed reducer", () => {
  const item = (id: string): FeedItemDTO => ({
    id, kind: "photo", caption: null, placeName: "x", destination: { id: "d", name: "D", slug: "d" }, author: { username: "a", displayName: null }, media: [],
    counts: { likes: 0, comments: 0, saves: 0, helpful: 0, tripAdds: 0 }, me: { liked: false, saved: false, helped: false }, experience: { crowd: null, conditions: [], vibes: [], tip: null, fromArea: false },
    freshness: { label: "now", state: "fresh", dot: "green", usableAsCurrent: true }, location: { lat: 1, lng: 1, precision: "approx", distanceKm: null }, canComment: true, isMine: false, createdAt: "2026-10-10T00:00:00Z",
  });
  const load = (s: FeedState, ids: string[], next: string | null, append = false) => feedReducer(s, { type: "loaded", items: ids.map(item), nextCursor: next, coldStart: false, append });

  it("first page, more pages without duplicates, then the end", () => {
    let s = load(initialFeed, ["a", "b"], "c1");
    expect(s.status).toBe("ready");
    s = feedReducer(s, { type: "more" }); expect(s.status).toBe("loadingMore");
    s = load(s, ["b", "c"], "c2", true); expect(s.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    s = load(s, ["d"], null, true); expect(s.status).toBe("end"); expect(s.items).toHaveLength(4);
  });
  it("'more' is ignored unless ready (no double requests)", () => {
    expect(feedReducer(initialFeed, { type: "more" }).status).toBe("loading");
    const busy = feedReducer(load(initialFeed, ["a"], "c"), { type: "more" });
    expect(feedReducer(busy, { type: "more" })).toBe(busy);
  });
  it("a failure keeps what is already loaded", () => {
    const s = feedReducer(load(initialFeed, ["a"], "c"), { type: "failed", message: "offline" });
    expect(s.status).toBe("error"); expect(s.items).toHaveLength(1); expect(s.error).toBe("offline");
  });
  it("optimistic patch and remove", () => {
    let s = load(initialFeed, ["a", "b"], "c");
    s = feedReducer(s, { type: "patch", id: "a", fn: (i) => ({ ...i, me: { ...i.me, liked: true }, counts: { ...i.counts, likes: 1 } }) });
    expect(s.items[0].me.liked).toBe(true); expect(s.items[1].me.liked).toBe(false);
    s = feedReducer(s, { type: "remove", id: "a" }); expect(s.items.map((i) => i.id)).toEqual(["b"]);
  });
  it("an empty first page with no cursor is an honest end, not an error", () => {
    expect(load(initialFeed, [], null).status).toBe("end");
  });
});

import { createProgressTracker } from "@/lib/client/video-progress";
describe("video progress tracker", () => {
  const run = (steps: [number, number][]) => { const out: string[] = []; const t = createProgressTracker((e) => out.push(e)); for (const [c, d] of steps) t.update(c, d); return { out, t }; };

  it("fires each quartile once, in order, however often the player reports time", () => {
    const { out } = run([[0, 20], [1, 20], [5, 20], [5.1, 20], [10, 20], [15, 20], [15.2, 20], [19.5, 20]]);
    expect(out).toEqual(["q25", "q50", "q75", "complete"]);
  });
  it("a viewer skipping ahead still passes the earlier milestones only as they are reached (no fake watch-through)", () => {
    expect(run([[0, 20], [19.5, 20]]).out).toEqual(["q25", "q50", "q75", "complete"]);   // seeking to the end counts as reaching it; watch TIME is what the server weighs
  });
  it("detects a loop as a replay and lets the milestones count again", () => {
    const { out, t } = run([[0, 10], [9.8, 10], [0.2, 10], [3, 10]]);
    expect(out.filter((e) => e === "replay")).toHaveLength(1);
    expect(out.filter((e) => e === "q25")).toHaveLength(2);
    expect(t.loops()).toBe(1);
  });
  it("a viewer seeking backwards mid-video is not a replay, and bad numbers are ignored", () => {
    expect(run([[0, 10], [5, 10], [1, 10]]).out).not.toContain("replay");
    expect(run([[1, 0], [Number.NaN, 10], [1, Number.POSITIVE_INFINITY]]).out).toEqual([]);
  });
});
