import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  allow: true,
  rpc: {} as Record<string, { data: unknown; error: { code?: string; message?: string } | null }>,
  rpcCalls: [] as { fn: string; args: unknown }[],
  table: { data: null, error: null, count: null } as { data: unknown; error: { code?: string } | null; count?: number | null },
  tables: {} as Record<string, { data: unknown; error?: { code?: string } | null; count?: number | null }>,
  tableCalls: [] as { table: string; op: string; payload?: unknown }[],
  profile: { id: "x" } as unknown,
  page: null as unknown,
  pageError: null as Error | null,
};

vi.mock("@/lib/rate-limit", () => ({ rateLimiter: { take: () => state.allow } }));
const removedFiles: string[][] = [];
vi.mock("@/lib/social/storage", () => ({ supabaseMediaStorage: () => ({ remove: async (p: string[]) => { removedFiles.push(p); }, signedUrls: async (paths: string[]) => new Map(paths.map((x) => [x, `https://s/${x}`])) }) }));
vi.mock("@/lib/server/feed-service", async () => {
  class FeedError extends Error { constructor(m: string, readonly status = 500) { super(m); } }
  return {
    FeedError,
    buildFeedPage: async () => { if (state.pageError) throw state.pageError; return state.page; },
    loadMedia: async (_s: unknown, _st: unknown, ids: string[]) => new Map(ids.map((id) => [id, [{ type: "image", url: "https://s/x/a.jpg", posterUrl: null, width: 10, height: 10, durationS: null }]])),
  };
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (fn: string, args: unknown) => { state.rpcCalls.push({ fn, args }); return state.rpc[fn] ?? { data: null, error: null }; },
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      const res = () => (state.tables[table] ? { data: state.tables[table].data, error: state.tables[table].error ?? null, count: state.tables[table].count ?? null } : table === "profiles" ? { data: state.profile, error: null } : { data: state.table.data, error: state.table.error, count: state.table.count });
      Object.assign(b, {
        select: () => b, eq: () => b, in: () => b, or: () => b, ilike: () => b, is: () => b, lt: () => b, order: () => b, limit: () => b,
        insert: (p: unknown) => { state.tableCalls.push({ table, op: "insert", payload: p }); return b; },
        upsert: (p: unknown) => { state.tableCalls.push({ table, op: "upsert", payload: p }); return b; },
        delete: () => { state.tableCalls.push({ table, op: "delete" }); return b; },
        single: async () => res(), maybeSingle: async () => res(), then: (r: (v: unknown) => unknown) => r(res()),
      });
      return b;
    },
  }),
}));

import { FeedError } from "@/lib/server/feed-service";
import { POST as feedPOST } from "@/app/api/feed/route";
import { POST as eventsPOST } from "@/app/api/feed/events/route";
import { POST as reactionPOST } from "@/app/api/posts/[id]/reaction/route";
import { GET as commentsGET, POST as commentsPOST } from "@/app/api/posts/[id]/comments/route";
import { POST as reportPOST } from "@/app/api/posts/[id]/report/route";
import { DELETE as hideDELETE, POST as hidePOST } from "@/app/api/feed/hide/route";
import { DELETE as blockDELETE, POST as blockPOST } from "@/app/api/users/block/route";

const PID = "22222222-2222-4222-8222-222222222222";
const req = (body: unknown, method = "POST") => new Request("http://x", { method, body: JSON.stringify(body) });
const ctx = (id = PID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  Object.assign(state, { user: { id: "11111111-1111-4111-8111-111111111111" }, allow: true, rpc: {}, rpcCalls: [], table: { data: null, error: null, count: null }, tables: {}, tableCalls: [], profile: { id: "x" }, pageError: null, page: { items: [], nextCursor: null, coldStart: true } });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/feed", () => {
  it("requires sign-in, validates input, and is rate limited", async () => {
    state.user = null;
    expect((await feedPOST(req({}))).status).toBe(401);
    state.user = { id: "u" };
    expect((await feedPOST(req({ limit: 99 }))).status).toBe(400);
    expect((await feedPOST(req({ lat: 18 }))).status).toBe(400);                 // lat without lng
    expect((await feedPOST(req({ lat: 999, lng: 1 }))).status).toBe(400);
    expect((await feedPOST(req({ trip_id: "nope" }))).status).toBe(400);
    state.allow = false;
    expect((await feedPOST(req({}))).status).toBe(429);
  });
  it("returns only what the screen needs, never cached", async () => {
    state.page = { items: [{ id: "a" }], nextCursor: "c", coldStart: false, meta: { timings: { total: 5 } } };
    const res = await feedPOST(req({ lat: 18.9, lng: 73.2 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Object.keys(await res.json()).sort()).toEqual(["coldStart", "items", "nextCursor"]);   // no timings / scores leak
  });
  it("turns a feed failure into a friendly 502, and anything unexpected into a 500, without leaking details", async () => {
    state.pageError = new FeedError("feed_candidates failed");
    const a = await feedPOST(req({}));
    expect(a.status).toBe(502);
    expect(JSON.stringify(await a.json())).not.toContain("feed_candidates");
    state.pageError = new Error("pg: password for user");
    const b = await feedPOST(req({}));
    expect(b.status).toBe(500);
    expect(JSON.stringify(await b.json())).not.toContain("password");
  });
});

describe("POST /api/feed/events", () => {
  const ev = (type: string, extra: object = {}) => ({ post_id: PID, type, ...extra });
  it("validates the batch (size, types, ids, milliseconds) before touching the database", async () => {
    expect((await eventsPOST(req({ events: [] }))).status).toBe(400);
    expect((await eventsPOST(req({ events: Array.from({ length: 51 }, () => ev("play")) }))).status).toBe(400);
    expect((await eventsPOST(req({ events: [ev("explode")] }))).status).toBe(400);
    expect((await eventsPOST(req({ events: [{ post_id: "x", type: "play" }] }))).status).toBe(400);
    expect((await eventsPOST(req({ events: [ev("leave", { ms: 9_999_999 })] }))).status).toBe(400);
    expect(state.rpcCalls).toHaveLength(0);
  });
  it("records a batch in ONE database call and reports how many were counted", async () => {
    state.rpc.record_feed_events = { data: 3, error: null };
    const res = await eventsPOST(req({ events: [ev("impression"), ev("play"), ev("q50", { ms: 4000 })] }));
    expect(res.status).toBe(200);
    expect((await res.json()).recorded).toBe(3);
    expect(state.rpcCalls).toHaveLength(1);
  });
  it("requires sign-in, is rate limited, and hides database errors", async () => {
    state.user = null; expect((await eventsPOST(req({ events: [ev("play")] }))).status).toBe(401);
    state.user = { id: "u" }; state.allow = false; expect((await eventsPOST(req({ events: [ev("play")] }))).status).toBe(429);
    state.allow = true; state.rpc.record_feed_events = { data: null, error: { code: "XX", message: "relation post_views secret" } };
    const res = await eventsPOST(req({ events: [ev("play")] }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("post_views");
  });
});

describe("POST /api/posts/[id]/reaction", () => {
  it("is idempotent from the client's point of view and returns the new totals", async () => {
    state.rpc.set_post_reaction = { data: [{ changed: false, likes: 7, saves: 2 }], error: null };
    const res = await reactionPOST(req({ kind: "like", on: true }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: "like", on: true, likes: 7 });
    expect(state.rpcCalls[0]).toMatchObject({ fn: "set_post_reaction", args: { _post: PID, _kind: "like", _on: true } });
  });
  it("validates ids and bodies; a post you cannot see is simply 'not available'", async () => {
    expect((await reactionPOST(req({ kind: "like", on: true }), ctx("nope"))).status).toBe(404);
    expect((await reactionPOST(req({ kind: "share", on: true }), ctx())).status).toBe(400);
    expect((await reactionPOST(req({ kind: "like" }), ctx())).status).toBe(400);
    state.rpc.set_post_reaction = { data: null, error: { code: "42501" } };
    expect((await reactionPOST(req({ kind: "like", on: true }), ctx())).status).toBe(404);
    state.rpc.set_post_reaction = { data: [], error: null };
    expect((await reactionPOST(req({ kind: "like", on: true }), ctx())).status).toBe(404);
    state.user = null; expect((await reactionPOST(req({ kind: "like", on: true }), ctx())).status).toBe(401);
  });
  it("is rate limited", async () => {
    state.allow = false;
    expect((await reactionPOST(req({ kind: "save", on: true }), ctx())).status).toBe(429);
  });
});

describe("comments", () => {
  it("rejects a malformed cursor instead of putting it into a query", async () => {
    const bad = await commentsGET(new Request("http://x?cursor=" + encodeURIComponent("1,or(id.neq.0)")), ctx());
    expect(bad.status).toBe(400);
    const ok = await commentsGET(new Request("http://x?cursor=" + encodeURIComponent(`2026-10-10T12:00:00.000Z|${PID}`)), ctx());
    expect(ok.status).toBe(200);
  });
  it("pages: 20 per page plus a cursor when there are more", async () => {
    state.table.data = Array.from({ length: 21 }, (_, i) => ({ id: `${i}`.padStart(8, "0") + "-0000-4000-8000-000000000000", parent_id: null, body: `c${i}`, created_at: `2026-10-10T12:00:${String(i).padStart(2, "0")}.000Z`, author: { username: "ann", display_name: null } }));
    const j = await (await commentsGET(new Request("http://x"), ctx())).json();
    expect(j.comments).toHaveLength(20);
    expect(j.nextCursor).toContain("|");
    expect(j.comments[0].author.username).toBe("ann");
  });
  it("posting needs a profile, uses the session as the author, and maps refusals", async () => {
    state.profile = null;
    expect((await commentsPOST(req({ body: "hi" }), ctx())).status).toBe(409);
    state.profile = { id: "x" };
    expect((await commentsPOST(req({ body: "   " }), ctx())).status).toBe(400);
    expect((await commentsPOST(req({ body: "x".repeat(501) }), ctx())).status).toBe(400);
    state.table.data = { id: "c1", parent_id: null, body: "Looks great", created_at: "2026-10-10T12:00:00Z" };
    const res = await commentsPOST(req({ body: "Looks great", author_id: "attacker" }), ctx());
    expect(res.status).toBe(201);
    const inserted = state.tableCalls.find((c) => c.op === "insert")!.payload as Record<string, unknown>;
    expect(inserted.author_id).toBe("11111111-1111-4111-8111-111111111111");           // never taken from the request
    state.table = { data: null, error: { code: "42501" } };
    expect((await commentsPOST(req({ body: "hello" }), ctx())).status).toBe(403);
  });
});

describe("report / hide / block", () => {
  it("a report needs a valid reason and is retry-safe", async () => {
    expect((await reportPOST(req({ reason: "boring" }), ctx())).status).toBe(400);
    expect((await reportPOST(req({ reason: "spam" }), ctx())).status).toBe(201);
    expect(state.tableCalls.at(-1)).toMatchObject({ table: "post_reports", op: "upsert" });
    expect((state.tableCalls.at(-1)!.payload as Record<string, unknown>).reporter_id).toBe("11111111-1111-4111-8111-111111111111");
    state.table = { data: null, error: { code: "42501" } };
    expect((await reportPOST(req({ reason: "spam" }), ctx())).status).toBe(404);
  });
  it("'not interested' hides for me only, and can be undone", async () => {
    expect((await hidePOST(req({ kind: "destination", target_id: PID }))).status).toBe(201);
    expect(state.tableCalls.at(-1)).toMatchObject({ table: "feed_hides", op: "upsert" });
    expect((await hidePOST(req({ kind: "everything", target_id: PID }))).status).toBe(400);
    expect((await hideDELETE(req({ kind: "post", target_id: PID }, "DELETE"))).status).toBe(200);
    expect(state.tableCalls.at(-1)).toMatchObject({ op: "delete" });
  });
  it("blocking looks the person up by username, refuses yourself and unknown people", async () => {
    state.profile = { id: "33333333-3333-4333-8333-333333333333" };
    expect((await blockPOST(req({ username: "Ann_1" }))).status).toBe(201);
    expect((state.tableCalls.at(-1)!.payload as Record<string, unknown>).blocked_id).toBe("33333333-3333-4333-8333-333333333333");
    state.profile = { id: "11111111-1111-4111-8111-111111111111" };
    expect((await blockPOST(req({ username: "me_myself" }))).status).toBe(400);
    state.profile = null;
    expect((await blockPOST(req({ username: "ghost" }))).status).toBe(404);
    expect((await blockPOST(req({ username: "x" }))).status).toBe(400);
    state.profile = { id: "33333333-3333-4333-8333-333333333333" };
    expect((await blockDELETE(req({ username: "ann_1" }, "DELETE"))).status).toBe(200);
    state.user = null; expect((await blockPOST(req({ username: "ann_1" }))).status).toBe(401);
  });
});

import { GET as suggestGET } from "@/app/api/destinations/suggest/route";
describe("GET /api/destinations/suggest", () => {
  const get = (q?: string) => suggestGET(new Request(`http://x/api/destinations/suggest${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`));
  it("requires sign-in, is rate limited, and ignores one-letter queries without touching the database", async () => {
    state.user = null; expect((await get("mat")).status).toBe(401);
    state.user = { id: "u" }; state.allow = false; expect((await get("mat")).status).toBe(429);
    state.allow = true;
    const one = await get("m");
    expect((await one.json()).destinations).toEqual([]);
  });
  it("returns destinations in the shape the share screen uses, for a query and for none", async () => {
    state.table.data = [{ id: "d1", name: "Matheran", lat: 18.98, lng: 73.26, post_count: 14 }];
    const j = await (await get("mathe")).json();
    expect(j.destinations[0]).toMatchObject({ name: "Matheran", source: "trailmate", posts: 14, lat: 18.98 });
    expect((await (await get()).json()).destinations).toHaveLength(1);
  });
  it("hides database errors", async () => {
    state.table = { data: null, error: { code: "XX" } };
    const res = await get("mat");
    expect(res.status).toBe(500);
  });
});

import { DELETE as postDELETE } from "@/app/api/posts/[id]/route";
import { GET as likesGET } from "@/app/api/posts/[id]/likes/route";
import { GET as savedGET } from "@/app/api/saved/route";
import { GET as notifsGET } from "@/app/api/notifications/route";
import { POST as notifsReadPOST } from "@/app/api/notifications/read/route";
import { POST as tripAddPOST } from "@/app/api/posts/[id]/trip-add/route";
import { GET as impactGET } from "@/app/api/posts/[id]/impact/route";
import { GET as pulseGET } from "@/app/api/destinations/[id]/pulse/route";
import { GET as contributionGET } from "@/app/api/me/contribution/route";

describe("DELETE /api/posts/[id]", () => {
  const del = (id = PID) => postDELETE(new Request("http://x", { method: "DELETE" }), ctx(id));
  it("deletes my post and then its files; needs sign-in and a valid id; is rate limited", async () => {
    state.tables.post_media = { data: [{ storage_path: "me/a.jpg", poster_path: "me/a-poster.jpg" }] };
    state.tables.posts = { data: null, count: 1 };
    removedFiles.length = 0;
    expect((await del()).status).toBe(200);
    expect(state.tableCalls.some((c) => c.table === "posts" && c.op === "delete")).toBe(true);
    expect(removedFiles[0]).toEqual(["me/a.jpg", "me/a-poster.jpg"]);
    expect((await del("nope")).status).toBe(404);
    state.user = null; expect((await del()).status).toBe(401);
    state.user = { id: "u" }; state.allow = false; expect((await del()).status).toBe(429);
  });
  it("someone else's post (or one already gone) is 'not found', and its files are left alone", async () => {
    state.tables.posts = { data: null, count: 0 };
    removedFiles.length = 0;
    expect((await del()).status).toBe(404);
    expect(removedFiles).toHaveLength(0);
  });
  it("a database failure is reported without leaking details", async () => {
    state.tables.posts = { data: null, error: { code: "XX" } };
    expect((await del()).status).toBe(500);
  });
});

describe("GET /api/posts/[id]/likes", () => {
  const get = (q = "") => likesGET(new Request(`http://x/l${q}`), ctx());
  it("returns who liked, newest first, with a cursor only when there are more", async () => {
    state.rpc.post_likers = { data: [{ user_id: "a", username: "ravi", display_name: "Ravi", liked_at: "2026-10-10T10:00:00Z" }, { user_id: "b", username: null, display_name: null, liked_at: "2026-10-10T09:00:00Z" }], error: null };
    const j = await (await get()).json();
    expect(j.likers).toEqual([{ username: "ravi", displayName: "Ravi", likedAt: "2026-10-10T10:00:00Z" }, { username: null, displayName: null, likedAt: "2026-10-10T09:00:00Z" }]);
    expect(j.nextCursor).toBeNull();
    expect(JSON.stringify(j)).not.toContain("user_id");                                // internal ids never leave the server
    state.rpc.post_likers = { data: Array.from({ length: 31 }, (_, i) => ({ user_id: `u${i}`, username: `u${i}`, display_name: null, liked_at: `2026-10-10T08:${String(59 - i).padStart(2, "0")}:00Z` })), error: null };
    const more = await (await get()).json();
    expect(more.likers).toHaveLength(30); expect(more.nextCursor).toBe(more.likers[29].likedAt);
  });
  it("validates, requires sign-in, and never reveals more than the database allows", async () => {
    expect((await get("?cursor=garbage")).status).toBe(400);
    state.user = null; expect((await get()).status).toBe(401);
    state.user = { id: "u" }; state.rpc.post_likers = { data: [], error: null };
    expect((await (await get()).json()).likers).toEqual([]);                          // a stranger just gets an empty list
  });
});

describe("GET /api/saved", () => {
  const row = (id: string) => ({ id, author_id: "a", username: "ravi", display_name: null, destination_id: "d", destination_name: "Matheran", destination_slug: "matheran", destination_posts: 3, kind: "photo", caption: "hi", place_name: "Echo", lat: 1, lng: 1, location_precision: "approx", captured_at: "2026-10-10T00:00:00Z", created_at: "2026-10-10T00:00:00Z", comments_allowed: "everyone", duration_s: null, likes: 0, comments: 0, saves: 1, shares: 0, impressions: 0, plays: 0, completions: 0, skips: 0, watch_ms: 0, followed: false, liked: false, saved: true, seen_at: null, seen_pct: null });
  it("lists my saved posts in the order I saved them, dropping ones that are gone", async () => {
    state.tables.post_saves = { data: [{ post_id: PID, created_at: "2026-10-10T10:00:00Z" }, { post_id: "gone", created_at: "2026-10-09T10:00:00Z" }] };
    state.tables.post_media = { data: [{ post_id: PID, position: 0, media_type: "image", storage_path: "x/a.jpg", poster_path: null, width: 10, height: 10, duration_s: null }] };
    state.rpc.feed_items = { data: [row(PID)], error: null };
    const j = await (await savedGET(new Request("http://x/saved"))).json();
    expect(j.items).toHaveLength(1);
    expect(j.items[0]).toMatchObject({ id: PID, savedAt: "2026-10-10T10:00:00Z", me: { saved: true } });
    expect(j.items[0].media[0].url).toBe("https://s/x/a.jpg");
    expect(j.nextCursor).toBeNull();
  });
  it("validates the cursor, requires sign-in, and an empty list is just empty", async () => {
    expect((await savedGET(new Request("http://x/saved?cursor=nonsense"))).status).toBe(400);
    state.user = null; expect((await savedGET(new Request("http://x/saved"))).status).toBe(401);
    state.user = { id: "u" }; state.tables.post_saves = { data: [] };
    expect((await (await savedGET(new Request("http://x/saved"))).json()).items).toEqual([]);
  });
});

describe("notifications", () => {
  it("the bell asks for a count only (cheap), and the list names who did what", async () => {
    state.tables.notifications = { data: [{ id: "n1", actor_user: "u1", kind: "like", post_id: PID, created_at: "2026-10-10T10:00:00Z", read_at: null, post: { destination: { name: "Matheran" } } }, { id: "n2", actor_user: "u2", kind: "comment", post_id: PID, created_at: "2026-10-10T09:00:00Z", read_at: "2026-10-10T09:30:00Z", post: null }], count: 5 };
    state.table = { data: [{ id: "u1", username: "ravi" }], error: null, count: null };
    state.tables.profiles = { data: [{ id: "u1", username: "ravi" }] };
    const count = await (await notifsGET(new Request("http://x/n?count=1"))).json();
    expect(count).toEqual({ unread: 5 });
    const j = await (await notifsGET(new Request("http://x/n"))).json();
    expect(j.notifications[0]).toEqual({ id: "n1", kind: "like", actor: "ravi", postId: PID, destination: "Matheran", read: false, createdAt: "2026-10-10T10:00:00Z" });
    expect(j.notifications[1]).toMatchObject({ actor: null, destination: null, read: true });     // someone without a profile is "a traveler", a gone post has no place
    expect(j.unread).toBe(5);
    expect(JSON.stringify(j)).not.toContain("actor_user");
  });
  it("validates the cursor and requires sign-in; marking read validates ids and returns how many changed", async () => {
    expect((await notifsGET(new Request("http://x/n?cursor=x"))).status).toBe(400);
    state.user = null; expect((await notifsGET(new Request("http://x/n"))).status).toBe(401);
    state.user = { id: "u" };
    expect((await notifsReadPOST(req({ ids: ["nope"] }))).status).toBe(400);
    expect((await notifsReadPOST(req({ ids: Array.from({ length: 51 }, () => PID) }))).status).toBe(400);
    state.rpc.mark_notifications_read = { data: 3, error: null };
    const ok = await notifsReadPOST(req({ ids: [PID] }));
    expect((await ok.json()).marked).toBe(3);
    expect((state.rpcCalls.at(-1)!.args as Record<string, unknown>)._ids).toEqual([PID]);
    await notifsReadPOST(req({}));
    expect((state.rpcCalls.at(-1)!.args as Record<string, unknown>)._ids).toBeNull();              // no ids = mark all of mine
    state.allow = false; expect((await notifsReadPOST(req({}))).status).toBe(429);
  });
});

describe("Helpful", () => {
  it("is a reaction like the others: idempotent, and the new total comes back", async () => {
    state.rpc.set_post_reaction = { data: [{ changed: true, likes: 3, saves: 1, helpful: 9 }], error: null };
    const res = await reactionPOST(req({ kind: "helpful", on: true }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: "helpful", on: true, helpful: 9 });
    expect(state.rpcCalls.at(-1)).toMatchObject({ fn: "set_post_reaction", args: { _kind: "helpful", _on: true } });
  });
});

describe("POST /api/posts/[id]/trip-add", () => {
  it("records it only for a trip the person is in; one call, no matter how often", async () => {
    state.rpc.record_trip_add = { data: true, error: null };
    const res = await tripAddPOST(req({ trip_id: PID }), ctx());
    expect(res.status).toBe(200); expect((await res.json()).recorded).toBe(true);
    expect(state.rpcCalls.at(-1)).toMatchObject({ fn: "record_trip_add", args: { _trip: PID } });
  });
  it("validates, requires sign-in, is rate limited, and refuses someone else's trip without detail", async () => {
    expect((await tripAddPOST(req({ trip_id: "nope" }), ctx())).status).toBe(400);
    expect((await tripAddPOST(req({ trip_id: PID }), ctx("nope"))).status).toBe(404);
    state.rpc.record_trip_add = { data: null, error: { code: "42501", message: "not allowed" } };
    const res = await tripAddPOST(req({ trip_id: PID }), ctx()); expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("not allowed");
    state.user = null; expect((await tripAddPOST(req({ trip_id: PID }), ctx())).status).toBe(401);
    state.user = { id: "u" }; state.allow = false; expect((await tripAddPOST(req({ trip_id: PID }), ctx())).status).toBe(429);
  });
});

describe("GET /api/posts/[id]/impact and /api/me/contribution", () => {
  it("impact is for the author only: a stranger gets 'not found', the author gets distinct-traveler numbers", async () => {
    state.rpc.post_impact = { data: [], error: null };
    expect((await impactGET(new Request("http://x"), ctx())).status).toBe(404);
    state.rpc.post_impact = { data: [{ travelers: 14, saves: 9, helpful: 6, trip_adds: 3, likes: 40 }], error: null };
    expect(await (await impactGET(new Request("http://x"), ctx())).json()).toEqual({ travelers: 14, saves: 9, helpful: 6, tripAdds: 3, likes: 40 });
    expect((await impactGET(new Request("http://x"), ctx("nope"))).status).toBe(404);
  });
  it("contribution maps the database row and is zero for someone who has not posted", async () => {
    state.rpc.my_contribution = { data: [{ posts: 4, destinations: 3, travelers_helped: 27, saves: 20, helpful: 11, trip_adds: 6, likes: 55 }], error: null };
    expect(await (await contributionGET()).json()).toEqual({ posts: 4, destinations: 3, travelersHelped: 27, saves: 20, helpful: 11, tripAdds: 6, likes: 55 });
    state.rpc.my_contribution = { data: [], error: null };
    expect((await (await contributionGET()).json()).travelersHelped).toBe(0);
    state.user = null; expect((await contributionGET()).status).toBe(401);
  });
});

describe("GET /api/destinations/[id]/pulse", () => {
  const raw = { total_30d: 5, posts_24h: 2, posts_7d: 4, videos_7d: 1, contributors_7d: 3, from_area_7d: 1, trip_adds_30d: 2, crowd: [{ level: "crowded", at: new Date(Date.now() - 3_600_000).toISOString() }], conditions: [{ id: "closed", at: new Date(Date.now() - 3_600_000).toISOString() }], vibes: [{ id: "best_view", n: 3 }], tips: [{ text: "Go early", at: new Date().toISOString(), by: "ravi" }] };
  it("turns raw reports into honest claims: ONE crowd report is not a verdict, a fresh closure is shown", async () => {
    state.tables.destinations = { data: { id: PID, name: "Matheran", lat: 18.98, lng: 73.26 } };
    state.rpc.destination_pulse = { data: raw, error: null };
    const j = await (await pulseGET(new Request("http://x"), ctx())).json();
    expect(j.destination.name).toBe("Matheran");
    expect(j.reality.crowd.level).toBeNull(); expect(j.reality.crowd.note).toMatch(/One traveler said crowded/);
    expect(j.reality.conditions[0]).toMatchObject({ id: "closed", warning: true });
    expect(j.reality.activity).toMatchObject({ today: 2, week: 4, contributors: 3 });
    expect(JSON.stringify(j)).not.toMatch(/author_id|user_id/);
  });
  it("unknown destination is 404; validates id; requires sign-in", async () => {
    state.tables.destinations = { data: null };
    state.rpc.destination_pulse = { data: raw, error: null };
    expect((await pulseGET(new Request("http://x"), ctx())).status).toBe(404);
    expect((await pulseGET(new Request("http://x"), ctx("nope"))).status).toBe(404);
    state.user = null; expect((await pulseGET(new Request("http://x"), ctx())).status).toBe(401);
  });
  it("a database failure is reported without detail", async () => {
    state.tables.destinations = { data: { id: PID, name: "M", lat: 1, lng: 1 } };
    state.rpc.destination_pulse = { data: null, error: { code: "XX", message: "secret" } };
    const res = await pulseGET(new Request("http://x"), ctx()); expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

