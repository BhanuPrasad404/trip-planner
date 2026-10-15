import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExploreItem } from "@/lib/explore/items";

const state = {
  user: { id: "me" } as { id: string } | null, quotaOk: true, rpc: [] as { kind: string; limit: number }[],
  saved: [] as Record<string, unknown>[], dbError: null as { code?: string; message?: string } | null, upserts: [] as Record<string, unknown>[], deletes: [] as { col: string; val: string }[],
};
const rateCalls: string[] = []; let rateOk = true;
vi.mock("@/lib/rate-limit", () => ({ rateLimiter: { take: (key: string) => { rateCalls.push(key); return rateOk; } } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (_n: string, args: { _kind: string; _limit: number }) => { state.rpc.push({ kind: args._kind, limit: args._limit }); return { data: state.quotaOk, error: null }; },
    from: (_t: string) => ({
      select: () => ({ order: () => ({ limit: async () => ({ data: state.saved, error: state.dbError }) }) }),
      upsert: async (row: Record<string, unknown>) => { state.upserts.push(row); return { error: state.dbError }; },
      delete: () => { const q = { eq: (col: string, val: string) => { state.deletes.push({ col, val }); return col === "place_key" ? Promise.resolve({ error: state.dbError }) : q; } }; return q; },
    }),
  }),
}));

const item = (id: number): ExploreItem => ({ id: `way/${id}`, name: `Fort ${String(id).padStart(2, "0")}`, category: "fort", lat: 17 + id * 0.01, lng: 78, notable: id <= 2, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null });
let list = Array.from({ length: 40 }, (_, i) => item(i + 1));
let loadError: Error | null = null;
const loads: { scope: unknown; category: string; allowed: boolean | null }[] = [];
vi.mock("@/lib/explore/store", () => ({ getExploreStore: () => ({}) }));
vi.mock("@/lib/explore/service", async (orig) => {
  const real = await orig<typeof import("@/lib/explore/service")>();
  return { ...real, loadExplore: async (scope: unknown, category: string, deps: { allowUpstream?: () => Promise<boolean> | boolean }) => {
    const allowed = deps.allowUpstream ? await deps.allowUpstream() : null;
    loads.push({ scope, category, allowed });
    if (loadError) throw loadError;
    return { items: list, stale: false, source: "live" as const, fetchedAt: Date.parse("2026-10-15T00:00:00Z") };
  } };
});
import { POST as explore } from "@/app/api/explore/route";
import { DELETE, GET, POST as save } from "@/app/api/saved-places/route";
import { ExploreQuotaError, ExploreUnavailableError } from "@/lib/explore/service";

const req = (b: unknown, method = "POST") => new Request("http://x", { method, body: typeof b === "string" ? b : JSON.stringify(b) });
beforeEach(() => { state.user = { id: "me" }; state.quotaOk = true; state.rpc = []; state.saved = []; state.dbError = null; state.upserts = []; state.deletes = []; rateOk = true; rateCalls.length = 0; loads.length = 0; loadError = null; list = Array.from({ length: 40 }, (_, i) => item(i + 1)); });

describe("POST /api/explore", () => {
  it("requires sign-in, valid JSON and valid input, and does no work for rejected requests", async () => {
    state.user = null;
    expect((await explore(req({ scope: { kind: "state", code: "TG" } }))).status).toBe(401);
    state.user = { id: "me" };
    expect((await explore(req("not json"))).status).toBe(400);
    for (const b of [{}, { scope: { kind: "state", code: "ZZ" } }, { scope: { kind: "state", code: "TG" }, category: "pubs" }, { scope: { kind: "state", code: "TG" }, limit: 999 }, { scope: { kind: "point", lat: 200, lng: 0 } }]) expect((await explore(req(b))).status).toBe(400);
    expect(loads).toHaveLength(0);
  });
  it("returns one page with the total and a cursor for the next, never cacheable by shared caches", async () => {
    const res = await explore(req({ scope: { kind: "state", code: "TG" }, category: "fort", limit: 18 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toMatchObject({ total: 40, nextCursor: 18, source: "live", stale: false, fetchedAt: "2026-10-15T00:00:00.000Z" });
    expect(body.items).toHaveLength(18);
    const last = await (await explore(req({ scope: { kind: "state", code: "TG" }, category: "fort", cursor: 36, limit: 18 }))).json();
    expect(last.items).toHaveLength(4); expect(last.nextCursor).toBeNull();
  });
  it("charges the daily allowance through the service (only the service decides when), as 'explore'", async () => {
    await explore(req({ scope: { kind: "state", code: "TG" } }));
    expect(loads[0].allowed).toBe(true);
    expect(state.rpc).toEqual([{ kind: "explore", limit: 150 }]);
    state.quotaOk = false;
    await explore(req({ scope: { kind: "state", code: "TG" } }));
    expect(loads[1].allowed).toBe(false);
  });
  it("sorts nearest to an anchor (the place itself when browsing around a point) and searches inside the results", async () => {
    list = [item(5), item(1), item(3)];
    const near = await (await explore(req({ scope: { kind: "point", lat: 17.03, lng: 78 }, sort: "nearest" }))).json();
    expect(near.items.map((i: ExploreItem) => i.id)).toEqual(["way/3", "way/1", "way/5"]);
    expect(near.items[0].km).toBe(0);
    const found = await (await explore(req({ scope: { kind: "state", code: "TG" }, q: "fort 05" }))).json();
    expect(found.items.map((i: ExploreItem) => i.id)).toEqual(["way/5"]);
  });
  it("is rate limited per person, before any work", async () => {
    rateOk = false;
    expect((await explore(req({ scope: { kind: "state", code: "TG" } }))).status).toBe(429);
    expect(rateCalls).toEqual(["explore:me"]); expect(loads).toHaveLength(0);
  });
  it("maps failures to safe, honest messages: allowance used (429), map servers busy (502), anything else (500, no internals)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    loadError = new ExploreQuotaError("x");
    let r = await explore(req({ scope: { kind: "state", code: "TG" } }));
    expect(r.status).toBe(429); expect((await r.json()).error).toMatch(/used today's place searches/);
    loadError = new ExploreUnavailableError("all map servers failed: overpass-api.de -> HTTP 429");
    r = await explore(req({ scope: { kind: "state", code: "TG" } }));
    expect(r.status).toBe(502); expect(JSON.stringify(await r.json())).not.toContain("overpass");
    loadError = new Error("secret internal detail");
    r = await explore(req({ scope: { kind: "state", code: "TG" } }));
    expect(r.status).toBe(500); expect(JSON.stringify(await r.json())).not.toContain("secret");
    log.mockRestore();
  });
});

describe("/api/saved-places", () => {
  const place = { key: "way/123", name: "Golconda Fort", lat: 17.38, lng: 78.4, category: "fort", region: "Telangana" };
  it("requires sign-in on every method", async () => {
    state.user = null;
    expect((await GET()).status).toBe(401); expect((await save(req(place))).status).toBe(401); expect((await DELETE(req({ key: "way/123" }, "DELETE"))).status).toBe(401);
  });
  it("lists my saved places, newest first, uncacheable", async () => {
    state.saved = [{ place_key: "way/1", name: "A", lat: 1, lng: 1, category: null, region: null, created_at: "x" }];
    const r = await GET();
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await r.json()).places).toHaveLength(1);
  });
  it("saves as the signed-in person (never as a user id from the body), idempotently", async () => {
    const r = await save(req({ ...place, user_id: "someone-else" }));
    expect(r.status).toBe(200);
    expect(state.upserts[0]).toEqual({ user_id: "me", place_key: "way/123", name: "Golconda Fort", lat: 17.38, lng: 78.4, category: "fort", region: "Telangana" });
  });
  it("validates what it saves", async () => {
    for (const b of [{}, { ...place, key: "a b" }, { ...place, name: "" }, { ...place, lat: 500 }, { ...place, key: "x".repeat(200) }]) expect((await save(req(b))).status).toBe(400);
    expect(state.upserts).toHaveLength(0);
  });
  it("says so plainly at the 500-place limit, and does not leak other database errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.dbError = { code: "54000", message: "You can save up to 500 saved places" };
    let r = await save(req(place)); expect(r.status).toBe(409); expect((await r.json()).error).toMatch(/up to 500/);
    state.dbError = { code: "XX000", message: "connection string postgres://secret" };
    r = await save(req(place)); expect(r.status).toBe(500); expect(JSON.stringify(await r.json())).not.toContain("secret");
    log.mockRestore();
  });
  it("removes only MY row for that place", async () => {
    expect((await DELETE(req({ key: "way/123" }, "DELETE"))).status).toBe(200);
    expect(state.deletes).toEqual([{ col: "user_id", val: "me" }, { col: "place_key", val: "way/123" }]);
    expect((await DELETE(req({ key: "bad key" }, "DELETE"))).status).toBe(400);
  });
  it("is rate limited per person", async () => {
    rateOk = false;
    expect((await GET()).status).toBe(429); expect((await save(req(place))).status).toBe(429); expect((await DELETE(req({ key: "way/1" }, "DELETE"))).status).toBe(429);
    expect(rateCalls.every((k) => k === "saved-places:me")).toBe(true);
  });
});
