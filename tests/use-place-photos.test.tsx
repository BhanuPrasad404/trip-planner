import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetKnownPhotos, usePlacePhotos } from "@/lib/client/use-place-photos";
import type { PlacePhoto, PlacePhotoQuery } from "@/lib/place-photos";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const photo = (n: string): PlacePhoto => ({ url: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${n}.jpg/330px-${n}.jpg`, width: 500, height: 300, title: n, pageUrl: `https://en.wikipedia.org/wiki/${n}`, source: "wikipedia", licence: "CC BY 4.0", author: "A" });
const q = (i: number, name = `Place ${i}`): PlacePhotoQuery => ({ key: `k${i}`, name, lat: 17 + i * 0.01, lng: 78 });

let seen: { key: string; name: string }[][] = [];
let reply: (places: { key: string }[]) => Response;
const realFetch = globalThis.fetch;
beforeEach(() => {
  forgetKnownPhotos(); seen = [];
  reply = (places) => new Response(JSON.stringify({ photos: Object.fromEntries(places.filter((_, i) => i % 2 === 0).map((p) => [p.key, photo(p.key)])) }), { status: 200 });
  globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => { const body = JSON.parse(String(init?.body)); seen.push(body.places); return reply(body.places); }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

async function run(places: PlacePhotoQuery[]) {
  let out: Record<string, PlacePhoto> = {};
  const C = ({ list }: { list: PlacePhotoQuery[] }) => { out = usePlacePhotos(list); return null; };
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<C list={places} />); });
  await act(async () => { await Promise.resolve(); });
  return { get: () => out, rerender: async (l: PlacePhotoQuery[]) => { await act(async () => { r.update(<C list={l} />); }); } };
}

describe("usePlacePhotos", () => {
  it("fills in photos for the places that have one and leaves the rest absent", async () => {
    const h = await run([q(0), q(1), q(2)]);
    expect(Object.keys(h.get()).sort()).toEqual(["k0", "k2"]);
  });
  it("asks about EVERY place, 30 per request (it used to stop after the first 30)", async () => {
    await run(Array.from({ length: 45 }, (_, i) => q(i)));
    expect(seen.map((b) => b.length)).toEqual([30, 15]);
  });
  it("caps one list at 90 places (3 requests) so a huge list cannot burn the daily allowance", async () => {
    await run(Array.from({ length: 200 }, (_, i) => q(i)));
    expect(seen).toHaveLength(3);
  });
  it("asks once per place: a re-render, the same place twice, or 'no photo' never triggers another request", async () => {
    const list = [q(0), q(1), { ...q(0), key: "dup" }];
    const h = await run(list);
    expect(seen.flat().length).toBe(2); // k0 and k1 (the duplicate shares k0's answer)
    await h.rerender([...list]);
    await h.rerender([q(1), q(0)]);
    expect(seen).toHaveLength(1);
  });
  it("never sends a name the route would reject for the whole batch (over 120 characters / blank / bad coordinates)", async () => {
    await run([q(0, "x".repeat(300)), q(1, "   "), { key: "bad", name: "Fort", lat: NaN, lng: 78 }, q(2)]);
    const sent = seen.flat();
    expect(sent.map((p) => p.key)).toEqual(["k0", "k2"]);
    expect(sent[0].name.length).toBe(120);
  });
  it("on a rate limit or error it shows nothing and remembers nothing, so the next visit can try again", async () => {
    reply = () => new Response("{}", { status: 429 });
    const h = await run([q(0), q(1)]);
    expect(h.get()).toEqual({});
    reply = (places) => new Response(JSON.stringify({ photos: { [places[0].key]: photo("x") } }), { status: 200 });
    const h2 = await run([q(0), q(1)]); // a new visit in the same tab: the failure must not have been remembered as "no photo"
    expect(Object.keys(h2.get())).toEqual(["k0"]);
  });
  it("places the server could not settle ('unresolved') are asked again next time; settled ones, including 'no photo', are not", async () => {
    reply = (places) => new Response(JSON.stringify({ photos: {}, unresolved: [places[0].key] }), { status: 200 });
    await run([q(0), q(1)]); // k0 unresolved, k1 settled as "no photo"
    reply = (places) => new Response(JSON.stringify({ photos: { [places[0].key]: photo("x") } }), { status: 200 });
    const h = await run([q(0), q(1)]); // a new visit in the same tab
    expect(seen[1].map((p) => p.key)).toEqual(["k0"]);
    expect(Object.keys(h.get())).toEqual(["k0"]);
  });
  it("never throws when offline", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const h = await run([q(0)]);
    expect(h.get()).toEqual({});
  });
});
