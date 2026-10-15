import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn<(url: string) => Promise<unknown>>(async () => null);
vi.mock("@/lib/place-photos/wikimedia", () => ({ wikimedia: { getJson: (u: string) => get(u) } }));
import { MemoryPhotoStore } from "@/lib/place-photos/store";
const store = new MemoryPhotoStore();
vi.mock("@/lib/place-photos/store", async () => { const a = await vi.importActual<typeof import("@/lib/place-photos/store")>("@/lib/place-photos/store"); return { ...a, getPhotoStore: () => store }; });
import { lookupPlacePhotos, upstreamDisabled } from "@/lib/place-photos";
import { resolvePlacePhotos } from "@/lib/place-photos/resolve";

const q = [{ key: "c", name: "Charminar", lat: 17.36, lng: 78.47 }];
const saved = process.env.PLACE_PHOTOS_UPSTREAM;
beforeEach(() => { get.mockClear(); delete process.env.PLACE_PHOTOS_UPSTREAM; vi.spyOn(console, "info").mockImplementation(() => {}); });
afterEach(() => { if (saved === undefined) delete process.env.PLACE_PHOTOS_UPSTREAM; else process.env.PLACE_PHOTOS_UPSTREAM = saved; vi.restoreAllMocks(); });

describe("kill switch: PLACE_PHOTOS_UPSTREAM=off", () => {
  it.each([["off", true], ["OFF", true], [" off ", true], ["", false], ["on", false], ["0", false]])("%j → disabled=%s", (v, off) => { process.env.PLACE_PHOTOS_UPSTREAM = v; expect(upstreamDisabled()).toBe(off); });
  it("makes no call to Wikimedia at all and reports the place as unresolved, not as 'no photo'", async () => {
    process.env.PLACE_PHOTOS_UPSTREAM = "off";
    const r = await lookupPlacePhotos(q);
    expect(get).not.toHaveBeenCalled();
    expect(r.unresolved).toEqual(["c"]);
    expect(r.reasons).toEqual({});
  });
  it("is checked before the caller's own allowance, so a disabled system never charges anyone", async () => {
    process.env.PLACE_PHOTOS_UPSTREAM = "off";
    const allow = vi.fn(() => true);
    await lookupPlacePhotos(q, { allowUpstream: allow });
    expect(allow).not.toHaveBeenCalled();
  });
  it("normally goes upstream (and asks the caller's allowance)", async () => {
    const allow = vi.fn(() => true);
    await lookupPlacePhotos(q, { allowUpstream: allow });
    expect(allow).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalled();
  });
});

describe("one log line per lookup that had to go upstream", () => {
  it("counts cached, found, none and unresolved", async () => {
    const log = vi.fn();
    const world = async (url: string) => (url.includes("prop=imageinfo") ? { query: { pages: [] } } : { query: { pages: [] } });
    await resolvePlacePhotos([{ key: "x", name: "Unknown Cave", lat: 10, lng: 10 }], { store: new MemoryPhotoStore(), get: world, log });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/1 places: 0 cached, 0 found, 1 none, 0 unresolved/);
  });
  it("says nothing when everything came from the cache", async () => {
    const log = vi.fn();
    const s = new MemoryPhotoStore();
    await resolvePlacePhotos([{ key: "x", name: "Unknown Cave", lat: 10, lng: 10 }], { store: s, get: async () => ({ query: { pages: [] } }) });
    await resolvePlacePhotos([{ key: "x", name: "Unknown Cave", lat: 10, lng: 10 }], { store: s, get: async () => null, log });
    expect(log).not.toHaveBeenCalled();
  });
  it("reports places it could not settle", async () => {
    const log = vi.fn();
    await resolvePlacePhotos([{ key: "x", name: "Unknown Cave", lat: 10, lng: 10 }], { store: new MemoryPhotoStore(), get: async () => null, log });
    expect(log.mock.calls[0][0]).toMatch(/1 unresolved/);
  });
});
