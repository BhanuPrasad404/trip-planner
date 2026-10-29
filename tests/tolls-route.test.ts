import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHUNK_POINTS, MAX_CHUNKS, chunkLine, fetchTollsAlong, tollQuery } from "@/lib/providers/tolls-overpass";
import type { LngLat } from "@/lib/trip/toll";
import { resetOverpassHealth } from "@/lib/overpass-health";

const state = { user: { id: "u1" } as { id: string } | null, quotaOk: true };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }) }));
vi.mock("@/lib/quota", () => ({ consumeQuota: async () => state.quotaOk }));
import { POST } from "@/app/api/tolls/route";

const M = 111_195;
/** A road north from (lat0, 78.0), a point every 400 m. `salt` makes every test's road different so the cache never hides a call. */
const road = (km: number, salt = 17): LngLat[] => Array.from({ length: Math.round((km * 1000) / 400) + 1 }, (_, i) => [78.0 + salt * 0.001, 12 + salt * 0.01 + (i * 400) / M] as LngLat);
const overpass = (...els: object[]) => ({ elements: els });
const booth = (id: number, lat: number, lon = 78.0, tags: Record<string, string> = { barrier: "toll_booth" }) => ({ type: "node", id, lat, lon, tags });
const post = (body: unknown, headers: Record<string, string> = {}) => POST(new Request("http://x/api/tolls", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));

let calls: { url: string; body: string }[]; let answers: (() => Response | Promise<Response>)[];
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  resetOverpassHealth();                                                    // each test is a fresh server process: nothing remembered as down
  state.user = { id: "u1" }; state.quotaOk = true; calls = []; answers = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, body: decodeURIComponent(String(init.body)) }); const a = answers.shift(); if (!a) throw new Error("no answer"); return a(); }));
});

describe("the Overpass lookup (kept small and polite)", () => {
  it("a short road is ONE query around its points, for toll booths and gantries only", () => {
    const q = tollQuery(road(2).slice(0, 3));
    expect(q).toContain('node["barrier"="toll_booth"](around:80,'); expect(q).toContain('node["highway"="toll_gantry"]'); expect(q).toContain("[timeout:25]");
  });
  it("a long road is cut into overlapping pieces so no query is huge", () => {
    const r = road(300); const chunks = chunkLine(r);
    expect(r.length).toBeGreaterThan(CHUNK_POINTS); expect(chunks.length).toBeGreaterThan(1); for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_POINTS);
    expect(chunks[0].at(-1)).toEqual(chunks[1][0]); // they overlap by one point: nothing falls in a gap
    expect(chunkLine(road(2))).toHaveLength(1);
  });
  it("finds plazas, merges the lanes of one plaza, and says the answer is complete", async () => {
    answers.push(() => json(overpass(booth(1, 12.5, 78.0, { barrier: "toll_booth", name: "Kothur Toll Plaza", charge: "Rs 105" }), booth(2, 12.5004), booth(3, 12.5008))));
    const r = await fetchTollsAlong([[78.0, 12.0], [78.0, 13.0]]);
    expect(r.complete).toBe(true); expect(r.tolls).toHaveLength(1); expect(r.tolls[0]).toMatchObject({ name: "Kothur Toll Plaza", fee: "Rs 105" });
  });
  it("tries the next map server when one fails or answers with an error remark", async () => {
    answers.push(() => json({}, 504), () => json({ remark: "runtime error: Query timed out" }), () => json(overpass(booth(9, 12.2))));
    const r = await fetchTollsAlong([[78.0, 12.0], [78.0, 13.0]]);
    expect(calls).toHaveLength(3); expect(new Set(calls.map((c) => new URL(c.url).host)).size).toBe(3); expect(r.tolls).toHaveLength(1);
  });
  it("if a piece of the road could not be checked, the answer says it may be incomplete (it never claims 'no tolls')", async () => {
    const winding: LngLat[] = Array.from({ length: 600 }, (_, i) => [78.0 + (i % 2) * 0.01, 12 + (i * 100) / M] as LngLat); // a road that really needs 3 pieces
    expect(chunkLine(winding).length).toBe(3);
    answers.push(() => json(overpass(booth(1, 12.1))), () => json({}, 500), () => json({}, 500), () => json({}, 500), () => json({}, 500), () => json({}, 500), () => json({}, 500));
    const r = await fetchTollsAlong(winding);
    expect(r.complete).toBe(false); expect(r.tolls).toHaveLength(1);
  });
  it("if NOTHING could be checked it fails, rather than returning an empty list that looks like 'no tolls'", async () => {
    answers.push(() => json({}, 500), () => json({}, 500), () => json({}, 500));
    await expect(fetchTollsAlong([[78.0, 12.0], [78.0, 13.0]])).rejects.toThrow(/unavailable/);
  });
  it("a route that would need more than the allowed number of queries is refused, not hammered", async () => {
    const wavy: LngLat[] = Array.from({ length: (CHUNK_POINTS - 1) * (MAX_CHUNKS + 1) + 50 }, (_, i) => [78.0 + (i % 2) * 0.01, 12 + (i * 100) / M] as LngLat);
    await expect(fetchTollsAlong(wavy)).rejects.toThrow(/too long/);
    expect(calls).toHaveLength(0);
  });
  it("it never asks the shared server about the same booth twice", async () => {
    answers.push(() => json(overpass(booth(5, 12.3), booth(5, 12.3))));
    expect((await fetchTollsAlong([[78.0, 12.0], [78.0, 13.0]])).tolls).toHaveLength(1);
  });
});

describe("POST /api/tolls", () => {
  const line = (salt: number) => road(20, salt);
  it("401 when signed out, before any map server is asked", async () => { state.user = null; expect((await post({ line: line(30) })).status).toBe(401); expect(calls).toHaveLength(0); });
  it("rejects a body that is not a route", async () => {
    for (const body of [{}, { line: [] }, { line: [[1, 2]] }, { line: [[200, 2], [1, 2]] }, { line: [[1, 95], [1, 2]] }, { line: "x" }, { line: [[1, 2], ["a", 2]] }]) expect((await post(body)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it("refuses an oversized request and a route longer than a country", async () => {
    expect((await post({ line: line(31) }, { "content-length": "900000" })).status).toBe(413);
    expect((await post({ line: [[78, 8], [78, 31]] })).status).toBe(400); // ~2,600 km
    expect(calls).toHaveLength(0);
  });
  it("429 when the daily limit is used up, before any map server is asked", async () => { state.quotaOk = false; expect((await post({ line: line(32) })).status).toBe(429); expect(calls).toHaveLength(0); });
  it("returns the plazas, with their source, and is never cached by the browser or a proxy", async () => {
    answers.push(() => json(overpass(booth(1, 12.35 + 33 * 0.01, 78.033, { barrier: "toll_booth", name: "Plaza" }))));
    const res = await post({ line: line(33) }); const j = await res.json();
    expect(res.status).toBe(200); expect(j).toMatchObject({ complete: true, source: "OpenStreetMap" }); expect(j.tolls).toHaveLength(1); expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
  it("the same route asked again is answered from the cache: the shared map server is asked once", async () => {
    answers.push(() => json(overpass(booth(1, 12.1))));
    await post({ line: line(34) }); const second = await post({ line: line(34) });
    expect(second.status).toBe(200); expect(calls).toHaveLength(1);
  });
  it("503 with a plain message when map data is down (one sentence: the screen decides how to say the rest)", async () => {
    answers.push(() => json({}, 500), () => json({}, 500), () => json({}, 500));
    const res = await post({ line: line(35) }); expect(res.status).toBe(503); expect((await res.json()).error).toBe("Toll data isn't available right now.");
  });
});
