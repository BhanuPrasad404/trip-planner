// T6: the routing service says "too many requests" or has a server error. One more try after a short wait, never a loop; after
// repeated failures the service is left alone for a minute so every request falls back to the labelled estimate at once.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRoutingCache, osrmGet, osrmRouting } from "@/lib/providers/routing-osrm";

const okJson = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const pts = [{ lat: 17.385, lng: 78.4867 }, { lat: 16.5062, lng: 80.648 }];
const table = { code: "Ok", durations: [[0, 18000], [18000, 0]], distances: [[0, 275000], [275000, 0]] };
const noSleep = async () => undefined;
beforeEach(() => clearRoutingCache());

describe("osrmGet: one bounded retry", () => {
  it("429 then OK: the second try is used", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 429 })).mockResolvedValueOnce(okJson(table));
    const res = await osrmGet("https://x/table", 1000, f as never, noSleep);
    expect(res.ok).toBe(true); expect(f).toHaveBeenCalledTimes(2);
  });
  it("500 twice: gives up after exactly two tries (never loops)", async () => {
    const f = vi.fn(async () => new Response("err", { status: 500 }));
    const res = await osrmGet("https://x/table", 1000, f as never, noSleep);
    expect(res.status).toBe(500); expect(f).toHaveBeenCalledTimes(2);
  });
  it("a bad request (400) is not retried: waiting cannot fix it", async () => {
    const f = vi.fn(async () => new Response("bad", { status: 400 }));
    await osrmGet("https://x/table", 1000, f as never, noSleep);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("after two failed calls in a row the service rests for a minute (no request at all), and is asked again after", async () => {
    let t = 1_000_000;
    const now = () => t;
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(osrmGet("https://x/a", 1000, down as never, noSleep, now)).rejects.toThrow();
    await expect(osrmGet("https://x/b", 1000, down as never, noSleep, now)).rejects.toThrow();
    down.mockClear();
    await expect(osrmGet("https://x/c", 1000, down as never, noSleep, now)).rejects.toThrow(/resting/);
    expect(down).not.toHaveBeenCalled();
    t += 61_000;
    const up = vi.fn(async () => okJson(table));
    expect((await osrmGet("https://x/d", 1000, up as never, noSleep, now)).ok).toBe(true);
  });
});

describe("the road table with a busy routing service", () => {
  it("429 then OK: a REAL table, not the estimate", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 429 })).mockResolvedValueOnce(okJson(table));
    const m = await osrmRouting.matrix(pts, f as never);
    expect(m.source).toBe("osrm"); expect(m.durations[0][1]).toBe(18000);
  });
  it("500 twice: the labelled estimate (the plan then keeps every place: see engine-routing-failsoft.test.ts)", async () => {
    const f = vi.fn(async () => new Response("err", { status: 500 }));
    const m = await osrmRouting.matrix(pts, f as never);
    expect(m.source).toBe("estimate"); expect(f).toHaveBeenCalledTimes(2);
  });
});
