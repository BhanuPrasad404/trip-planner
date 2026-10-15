import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearFileMetaCache } from "@/lib/place-photos/commons-meta";
import { isUtilityName, resolvePlacePhotos, titleVariants, type ResolveDeps } from "@/lib/place-photos/resolve";
import { MemoryPhotoStore, photoKey, type PhotoStore } from "@/lib/place-photos/store";
import type { PlacePhotoQuery } from "@/lib/place-photos/types";

// ---- A fake Wikipedia + Wikidata + Commons, answering in the real API's response shapes -----------------------------------------
type PageSpec = { lat?: number; lng?: number; file?: string; wikidata?: string; disambiguation?: boolean };
type FileSpec = { licence?: string; code?: string; noThumb?: boolean; w?: number; h?: number; artist?: string };
type CommonsFileSpec = { file: string; lat?: number; lng?: number };
type World = {
  pages?: Record<string, PageSpec>; redirects?: Record<string, string>; search?: Record<string, string[]>; geo?: string[];
  images?: Record<string, string[]>; wikidata?: Record<string, string>; files?: Record<string, FileSpec>;
  /** Commons file pages geotagged near the point / found by a name search (file namespace). */
  commonsGeo?: CommonsFileSpec[]; commonsSearch?: Record<string, CommonsFileSpec[]>;
};
const kinds = () => ({ exact: 0, search: 0, geo: 0, images: 0, wikidata: 0, fileinfo: 0, commonsGeo: 0, commonsSearch: 0, total: 0 });

function wiki(w: World, fail: Partial<Record<keyof ReturnType<typeof kinds>, boolean>> = {}) {
  const calls = kinds();
  const pageJson = (title: string) => {
    const s = w.pages?.[title];
    if (!s) return { title, missing: true };
    return {
      pageid: 1, title,
      ...(s.lat !== undefined ? { coordinates: [{ lat: s.lat, lon: s.lng, primary: true }] } : {}),
      ...(s.file ? { pageimage: s.file } : {}),
      pageprops: { ...(s.wikidata ? { wikibase_item: s.wikidata } : {}), ...(s.disambiguation ? { disambiguation: "" } : {}) },
    };
  };
  const commonsPage = (f: CommonsFileSpec) => ({ pageid: 2, ns: 6, title: `File:${f.file.replace(/_/g, " ")}`, ...(f.lat !== undefined ? { coordinates: [{ lat: f.lat, lon: f.lng, primary: true }] } : {}) });
  const get = vi.fn(async (url: string): Promise<unknown | null> => {
    calls.total++;
    const u = new URL(url);
    const q = u.searchParams;
    if (u.hostname === "commons.wikimedia.org" && q.get("gsrnamespace") === "6") {
      calls.commonsSearch++; if (fail.commonsSearch) return null;
      return { query: { pages: (w.commonsSearch?.[q.get("gsrsearch")!] ?? []).map(commonsPage) } };
    }
    if (u.hostname === "commons.wikimedia.org" && q.get("ggsnamespace") === "6") {
      calls.commonsGeo++; if (fail.commonsGeo) return null;
      return { query: { pages: (w.commonsGeo ?? []).map(commonsPage) } };
    }
    if (u.hostname === "www.wikidata.org") {
      calls.wikidata++; if (fail.wikidata) return null;
      return { entities: Object.fromEntries(q.get("ids")!.split("|").map((id) => [id, w.wikidata?.[id] ? { claims: { P18: [{ rank: "normal", mainsnak: { datavalue: { value: w.wikidata[id] } } }] } } : { claims: {} }])) };
    }
    if (q.get("prop") === "imageinfo") {
      calls.fileinfo++; if (fail.fileinfo) return null;
      return { query: { pages: q.get("titles")!.split("|").map((t) => {
        const f = t.replace(/^File:/, "").replace(/ /g, "_");
        const s = w.files?.[f];
        if (!s) return { title: t, missing: true };
        const wd = s.w ?? 2000, ht = s.h ?? 1333;
        return { title: t, imageinfo: [{ ...(s.noThumb ? { url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${f}` } : { thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${f}/500px-${f}`, thumbwidth: 500 }), thumbheight: Math.round((500 * ht) / wd), width: wd, height: ht, mime: "image/jpeg",
          extmetadata: { LicenseShortName: { value: s.licence ?? "CC BY-SA 4.0" }, ...(s.code ? { License: { value: s.code } } : {}), LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" }, Artist: { value: s.artist ?? "<a href='//x'>Jane Doe</a>" } } }] };
      }) } };
    }
    if (q.get("prop") === "images") {
      calls.images++; if (fail.images) return null;
      return { query: { pages: q.get("titles")!.split("|").map((t) => ({ title: t, images: (w.images?.[t] ?? []).map((f) => ({ ns: 6, title: `File:${f}` })) })) } };
    }
    if (q.get("generator") === "search") {
      calls.search++; if (fail.search) return null;
      return { query: { pages: (w.search?.[q.get("gsrsearch")!] ?? []).map(pageJson) } };
    }
    if (q.get("generator") === "geosearch") {
      calls.geo++; if (fail.geo) return null;
      return { query: { pages: (w.geo ?? []).map(pageJson) } };
    }
    calls.exact++; if (fail.exact) return null;
    const redirects: { from: string; to: string }[] = [];
    const pages = q.get("titles")!.split("|").map((t) => { const to = w.redirects?.[t]; if (to) redirects.push({ from: t, to }); return pageJson(to ?? t); });
    return { query: { ...(redirects.length ? { redirects } : {}), pages } };
  });
  return { get, calls };
}

const q = (key: string, name: string, lat: number, lng: number): PlacePhotoQuery => ({ key, name, lat, lng });
const charminar = q("c", "Charminar", 17.3616, 78.4747);
const baseWorld = (): World => ({
  pages: { Charminar: { lat: 17.3616, lng: 78.4747, file: "Charminar_Hyderabad.jpg", wikidata: "Q1" } },
  files: { "Charminar_Hyderabad.jpg": {} },
});
const deps = (get: ResolveDeps["get"], over: Partial<ResolveDeps> = {}): ResolveDeps => ({ store: new MemoryPhotoStore(), get, ...over });
beforeEach(() => clearFileMetaCache());

describe("exact title: the primary, most reliable strategy", () => {
  it("finds a famous place in two requests (article + licence), with full credit and right-sized files", async () => {
    const w = wiki(baseWorld());
    const r = await resolvePlacePhotos([charminar], deps(w.get));
    expect(r.photos.c).toMatchObject({ source: "wikipedia", via: "exact", title: "Charminar", author: "Jane Doe", licence: "CC BY-SA 4.0", file: "Charminar_Hyderabad.jpg", wikidata: "Q1",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Charminar_Hyderabad.jpg", pageUrl: "https://en.wikipedia.org/wiki/Charminar" });
    expect(r.photos.c.url).toContain("/330px-");
    expect(r.photos.c.srcSet).toContain("120w");
    expect(w.calls).toMatchObject({ exact: 1, fileinfo: 1, search: 0, geo: 0, images: 0, wikidata: 0, total: 2 });
    expect(r.unresolved).toEqual([]);
  });
  it("follows an editor's redirect: 'Golconda Fort' IS the article 'Golconda', even though the title is a bare name and 1.2 km from the pin", async () => {
    const w = wiki({ pages: { Golconda: { lat: 17.3945, lng: 78.4011, file: "Golconda_Fort.jpg" } }, redirects: { "Golconda Fort": "Golconda" }, files: { "Golconda_Fort.jpg": {} } });
    const r = await resolvePlacePhotos([q("g", "Golconda Fort", 17.3833, 78.4011)], deps(w.get));
    expect(r.photos.g).toMatchObject({ title: "Golconda", via: "exact" });
  });
  it("looks up ALL exact titles for a whole list in ONE request, and all licences in one more", async () => {
    const pages: Record<string, PageSpec> = {}; const files: Record<string, FileSpec> = {}; const qs: PlacePhotoQuery[] = [];
    for (let i = 0; i < 19; i++) { pages[`Place Number${i}`] = { lat: 17 + i * 0.1, lng: 78, file: `P${i}.jpg` }; files[`P${i}.jpg`] = {}; qs.push(q(`k${i}`, `Place Number${i}`, 17 + i * 0.1, 78)); }
    const w = wiki({ pages, files });
    const r = await resolvePlacePhotos(qs, deps(w.get));
    expect(Object.keys(r.photos)).toHaveLength(19);
    expect(w.calls).toMatchObject({ exact: 1, fileinfo: 1, total: 2 }); // 19 places, 2 requests (it used to be 20+)
  });
  it("tries sensible spellings: honorific stripped, text after a comma dropped", async () => {
    const w = wiki({ pages: { "Kanaka Durga Temple": { lat: 16.51, lng: 80.61, file: "Kanaka.jpg" } }, files: { "Kanaka.jpg": {} } });
    const r = await resolvePlacePhotos([q("k", "Sri Kanaka Durga Temple, Vijayawada", 16.51, 80.61)], deps(w.get));
    expect(r.photos.k?.title).toBe("Kanaka Durga Temple");
  });
  it("refuses a same-named article that is far away (another Kondapalli Fort), and says why", async () => {
    const w = wiki({ pages: { "Kondapalli Fort": { lat: 14.0, lng: 76.0, file: "K.jpg" } }, files: { "K.jpg": {} } });
    const r = await resolvePlacePhotos([q("k", "Kondapalli Fort", 16.62, 80.54)], deps(w.get));
    expect(r.photos).toEqual({});
    expect(r.reasons.k).toBe("far");
  });
  it("never uses a disambiguation page, or an article with no coordinates (location cannot be proven)", async () => {
    const w = wiki({ pages: { Mercury: { lat: 17, lng: 78, file: "M.jpg", disambiguation: true }, "Old Fort": { file: "O.jpg" } }, files: { "M.jpg": {}, "O.jpg": {} } });
    const r = await resolvePlacePhotos([q("m", "Mercury", 17, 78), q("o", "Old Fort", 17, 78)], deps(w.get));
    expect(r.photos).toEqual({});
    expect(r.reasons).toMatchObject({ m: "disambiguation", o: "no_page" });
  });
});

describe("fallback strategies", () => {
  it("name search finds it when no article has exactly that title", async () => {
    const w = wiki({ pages: { "Thousand Pillar Temple": { lat: 18.0, lng: 79.58, file: "TP.jpg" } }, search: { "Thousand Pillar Temple Hanamkonda": ["Thousand Pillar Temple"] }, files: { "TP.jpg": {} } });
    const r = await resolvePlacePhotos([q("t", "Thousand Pillar Temple Hanamkonda", 18.0, 79.58)], deps(w.get));
    expect(r.photos.t).toMatchObject({ title: "Thousand Pillar Temple", via: "search" });
  });
  it("search results must still be THIS place: a different temple nearby is not accepted", async () => {
    const w = wiki({ pages: { "Bhadrakali Temple": { lat: 18.0, lng: 79.58, file: "B.jpg" } }, search: { "Thousand Pillar Temple Hanamkonda": ["Bhadrakali Temple"] }, files: { "B.jpg": {} } });
    const r = await resolvePlacePhotos([q("t", "Thousand Pillar Temple Hanamkonda", 18.0, 79.58)], deps(w.get));
    expect(r.photos).toEqual({});
  });
  it("articles around the point are the last resort, and are shared by places in the same cell", async () => {
    const w = wiki({ pages: { "Hidden Falls": { lat: 17.5, lng: 79.0, file: "H.jpg" } }, geo: ["Hidden Falls"], files: { "H.jpg": {} } });
    const r = await resolvePlacePhotos([q("a", "Hidden Waterfall", 17.5001, 79.0001), q("b", "Hidden Waterfalls", 17.5002, 79.0002)], deps(w.get));
    expect(r.photos.a?.via).toBe("geosearch"); // "waterfall" and "falls" are the same kind of place
    expect(r.photos.b?.via).toBe("geosearch");
    expect(w.calls.geo).toBe(1); // one geosearch for the whole ~100 m cell
  });
});

describe("choosing the photo", () => {
  it("when the lead image is a map, Wikidata's image for the same item is used instead", async () => {
    const w = wiki({ pages: { Golconda: { lat: 17.38, lng: 78.4, file: "Golconda_locator_map.png", wikidata: "Q42" } }, redirects: { "Golconda Fort": "Golconda" },
      wikidata: { Q42: "Golconda Fort view.jpg" }, files: { "Golconda_locator_map.png": {}, "Golconda_Fort_view.jpg": {} } });
    const r = await resolvePlacePhotos([q("g", "Golconda Fort", 17.38, 78.4)], deps(w.get));
    expect(r.photos.g.file).toBe("Golconda_Fort_view.jpg");
    expect(w.calls).toMatchObject({ wikidata: 1, images: 1 }); // the extra calls happen only because stage 1 failed
  });
  it("with no lead image, an article image whose NAME carries the place is used; a king's portrait is not", async () => {
    const w = wiki({ pages: { Warangal: { lat: 17.95, lng: 79.6 } }, redirects: { "Warangal Fort": "Warangal" }, images: { Warangal: ["Qutb_Shah_portrait.jpg", "Warangal_Fort_gate.jpg", "Commons-logo.svg"] },
      files: { "Qutb_Shah_portrait.jpg": {}, "Warangal_Fort_gate.jpg": {} } });
    const r = await resolvePlacePhotos([q("w", "Warangal Fort", 17.95, 79.6)], deps(w.get));
    expect(r.photos.w.file).toBe("Warangal_Fort_gate.jpg");
  });
  it("only a portrait is available → no photo ('image_rejected'), never the wrong picture", async () => {
    const w = wiki({ pages: { Warangal: { lat: 17.95, lng: 79.6 } }, redirects: { "Warangal Fort": "Warangal" }, images: { Warangal: ["Qutb_Shah_portrait.jpg"] }, files: { "Qutb_Shah_portrait.jpg": {} } });
    const r = await resolvePlacePhotos([q("w", "Warangal Fort", 17.95, 79.6)], deps(w.get));
    expect(r.photos).toEqual({});
    expect(r.reasons.w).toBe("no_image");
  });
  it("a photo that is not freely licensed is never shown, and the reason is 'licence'", async () => {
    const w = wiki({ pages: { Charminar: { lat: 17.3616, lng: 78.4747, file: "C.jpg" } }, files: { "C.jpg": { licence: "CC BY-NC 4.0" } } });
    const r = await resolvePlacePhotos([charminar], deps(w.get));
    expect(r.photos).toEqual({});
    expect(r.reasons.c).toBe("licence");
  });
});

describe("honesty about failure", () => {
  it("if Wikipedia cannot be reached the place is UNRESOLVED (ask again later), not 'no photo', and nothing is cached", async () => {
    const store = new MemoryPhotoStore();
    const down = wiki(baseWorld(), { exact: true, search: true, geo: true });
    const r1 = await resolvePlacePhotos([charminar], deps(down.get, { store }));
    expect(r1.unresolved).toEqual(["c"]);
    expect(r1.reasons).toEqual({});
    expect(await store.getMany(["charminar@17.36,78.47"])).toEqual(new Map());
    const up = wiki(baseWorld());
    const r2 = await resolvePlacePhotos([charminar], deps(up.get, { store }));
    expect(Object.keys(r2.photos)).toEqual(["c"]); // recovered; the outage left nothing behind
  });
  it("if only the licence check fails, the place is unresolved (an unknown licence is never assumed free)", async () => {
    const w = wiki(baseWorld(), { fileinfo: true });
    const r = await resolvePlacePhotos([charminar], deps(w.get));
    expect(r.photos).toEqual({});
    expect(r.unresolved).toEqual(["c"]);
  });
  it("exact lookup failing but search succeeding still resolves the place", async () => {
    const w = wiki({ ...baseWorld(), search: { Charminar: ["Charminar"] } }, { exact: true });
    const r = await resolvePlacePhotos([charminar], deps(w.get));
    expect(r.photos.c?.via).toBe("search");
  });
  it("if the exact lookup could not run and the other strategies simply found nothing, that is NOT a verdict of 'no photo'", async () => {
    // search and nearby articles answer fine (and have nothing), but the strategy most likely to find Charminar was never checked
    const w = wiki(baseWorld(), { exact: true });
    const store = new MemoryPhotoStore();
    const r = await resolvePlacePhotos([charminar], deps(w.get, { store }));
    expect(r.photos).toEqual({});
    expect(r.reasons).toEqual({});
    expect(r.unresolved).toEqual(["c"]);
    expect((await store.getMany(["charminar@17.36,78.47"])).size).toBe(0);
  });
  it("one place failing does not take the others down", async () => {
    const w = wiki({ pages: { Charminar: { lat: 17.3616, lng: 78.4747, file: "C.jpg" } }, files: { "C.jpg": {} } });
    const r = await resolvePlacePhotos([charminar, q("x", "Unknown Cave", 10, 10)], deps(w.get));
    expect(Object.keys(r.photos)).toEqual(["c"]);
    expect(r.reasons.x).toBe("no_page"); // all strategies ran and answered: that IS a definite "none"
  });
  it("never throws when the HTTP layer itself throws", async () => {
    const r = await resolvePlacePhotos([charminar], deps((async () => { throw new Error("kaboom"); }) as never));
    expect(r.photos).toEqual({});
    expect(r.unresolved).toEqual(["c"]);
  });
});

describe("diagnostic trail: every step, in words, so a missing photo can be explained", () => {
  const trailOf = async (w: World, query: PlacePhotoQuery) => (await resolvePlacePhotos([query], deps(wiki(w).get))).trails[query.key]?.join("\n") ?? "";

  it("says which spellings were tried and that no article exists", async () => {
    const t = await trailOf({}, q("x", "Sri Unknown Cave, Hyderabad", 17, 78));
    expect(t).toContain('exact title "Sri Unknown Cave, Hyderabad": no such article');
    expect(t).toContain('search "Sri Unknown Cave, Hyderabad"');
    expect(t).toContain("articles near the point");
  });
  it("shows how far a same-named article is, and the limit", async () => {
    const t = await trailOf({ pages: { "Kondapalli Fort": { lat: 14, lng: 76, file: "K.jpg" } }, files: { "K.jpg": {} } }, q("k", "Kondapalli Fort", 16.62, 80.54));
    expect(t).toMatch(/article is \d+\.\d km from the place \(limit 5 km\)/);
  });
  it("names a redirect, and says when an article has no coordinates", async () => {
    const r = await trailOf({ pages: { Golconda: { file: "G.jpg" } }, redirects: { "Golconda Fort": "Golconda" }, files: { "G.jpg": {} } }, q("g", "Golconda Fort", 17.38, 78.4));
    expect(r).toContain('"Golconda Fort" → redirects to "Golconda"');
    expect(r).toContain("has no coordinates, so its location cannot be checked");
  });
  it("lists every candidate photo with the exact reason it was refused, including the licence Commons reported", async () => {
    const t = await trailOf({ pages: { Charminar: { lat: 17.3616, lng: 78.4747, file: "Charminar_a.jpg" } }, files: { "Charminar_a.jpg": { licence: "GFDL 1.2" } } }, charminar);
    expect(t).toContain('lead image "Charminar_a.jpg": rejected: licence "GFDL 1.2" is not on our free-licence list');
  });
  it("says when a file is not on Commons at all (a file local to Wikipedia can be non-free)", async () => {
    const t = await trailOf({ pages: { Charminar: { lat: 17.3616, lng: 78.4747, file: "Local_only.jpg" } }, files: {} }, charminar);
    expect(t).toContain("not found on Wikimedia Commons");
  });
  it("explains a rejection by name, size and type just as precisely", async () => {
    const t = await trailOf({ pages: { Golconda: { lat: 17.38, lng: 78.4, file: "Golconda_locator_map.png" } }, redirects: { "Golconda Fort": "Golconda" }, files: { "Golconda_locator_map.png": {} } }, q("g", "Golconda Fort", 17.38, 78.4));
    expect(t).toContain("file name looks like a map, flag, logo or plan");
    const small = await trailOf({ pages: { Charminar: { lat: 17.3616, lng: 78.4747, file: "Tiny.jpg" } }, files: { "Tiny.jpg": { w: 120, h: 90 } } }, charminar);
    expect(small).toContain("too small (120px wide, needs 300)");
  });
  it("records the chosen photo on success", async () => {
    const t = await trailOf(baseWorld(), charminar);
    expect(t).toContain('exact title "Charminar": ACCEPTED');
    expect(t).toContain('photo CHOSEN: "Charminar_Hyderabad.jpg" (lead, CC BY-SA 4.0)');
  });
  it("has no trail for answers served from the cache (nothing was looked up)", async () => {
    const store = new MemoryPhotoStore();
    await resolvePlacePhotos([charminar], deps(wiki(baseWorld()).get, { store }));
    expect((await resolvePlacePhotos([charminar], deps(wiki(baseWorld()).get, { store }))).trails).toEqual({});
  });
});

describe("the shared cache", () => {
  it("asks upstream once: the second call (any user, any instance) costs nothing — for photos AND for 'no photo'", async () => {
    const store = new MemoryPhotoStore();
    const w = wiki({ ...baseWorld() });
    const list = [charminar, q("x", "Unknown Cave", 10, 10)];
    await resolvePlacePhotos(list, deps(w.get, { store }));
    const first = w.calls.total;
    const r = await resolvePlacePhotos(list, deps(w.get, { store }));
    expect(w.calls.total).toBe(first);
    expect(Object.keys(r.photos)).toEqual(["c"]);
    expect(r.reasons.x).toBe("no_page");
  });
  it("two queries for the same place share one lookup and both get the photo", async () => {
    const w = wiki(baseWorld());
    const r = await resolvePlacePhotos([charminar, { ...charminar, key: "again", name: "  CHARMINAR " }], deps(w.get));
    expect(Object.keys(r.photos).sort()).toEqual(["again", "c"]);
    expect(w.calls.exact).toBe(1);
  });
  it("the allowance is checked only when something is actually missing", async () => {
    const store = new MemoryPhotoStore();
    const allow = vi.fn(() => true);
    await resolvePlacePhotos([charminar], deps(wiki(baseWorld()).get, { store, allowUpstream: allow }));
    expect(allow).toHaveBeenCalledTimes(1);
    await resolvePlacePhotos([charminar], deps(wiki(baseWorld()).get, { store, allowUpstream: allow }));
    expect(allow).toHaveBeenCalledTimes(1); // all cached → not asked, nothing charged
  });
  it("when the allowance is used up, cached photos are still served and the rest is 'unresolved', with zero upstream calls", async () => {
    const store = new MemoryPhotoStore();
    await resolvePlacePhotos([charminar], deps(wiki(baseWorld()).get, { store }));
    const w = wiki(baseWorld());
    const r = await resolvePlacePhotos([charminar, q("n", "Brand New Fort", 12, 77)], deps(w.get, { store, allowUpstream: () => false }));
    expect(Object.keys(r.photos)).toEqual(["c"]);
    expect(r.unresolved).toEqual(["n"]);
    expect(w.calls.total).toBe(0);
  });
  it("a broken cache never breaks lookups (read AND write failures are survived)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const store: PhotoStore = { getMany: async () => { throw new Error("db down"); }, putMany: async () => { throw new Error("db down"); } };
    const r = await resolvePlacePhotos([charminar], deps(wiki(baseWorld()).get, { store }));
    expect(Object.keys(r.photos)).toEqual(["c"]);
    err.mockRestore();
  });
  it("limits how many places one call looks up upstream; the rest are left for next time", async () => {
    const pages: Record<string, PageSpec> = {}; const files: Record<string, FileSpec> = {}; const qs: PlacePhotoQuery[] = [];
    for (let i = 0; i < 6; i++) { pages[`Spot Number${i}`] = { lat: 17 + i * 0.1, lng: 78, file: `S${i}.jpg` }; files[`S${i}.jpg`] = {}; qs.push(q(`k${i}`, `Spot Number${i}`, 17 + i * 0.1, 78)); }
    const r = await resolvePlacePhotos(qs, deps(wiki({ pages, files }).get, { maxLookups: 4 }));
    expect(Object.keys(r.photos)).toHaveLength(4);
    expect(r.unresolved).toHaveLength(2);
  });
});

describe("what is never looked up", () => {
  it.each(["Restroom", "HP Petrol Pump", "Parking", "ATM", "Public toilets", "Pharmacy", "Beach", "Temple"])("%s: no request at all", async (name) => {
    const w = wiki({});
    const r = await resolvePlacePhotos([q("u", name, 17, 78)], deps(w.get));
    expect(w.calls.total).toBe(0);
    expect(r.photos).toEqual({});
  });
  it("utility detection: a car park or toilet block at a temple is not the temple", () => {
    expect(isUtilityName("Temple parking")).toBe(true);
    expect(isUtilityName("Shell Fuel Station")).toBe(true);
    expect(isUtilityName("Kanaka Durga Temple")).toBe(false);
    expect(isUtilityName("Golconda Fort")).toBe(false);
  });
  it("ignores unusable queries (blank name, impossible coordinates) without failing the rest", async () => {
    const w = wiki(baseWorld());
    const r = await resolvePlacePhotos([q("a", "   ", 17, 78), q("b", "X", NaN, 78), charminar], deps(w.get));
    expect(Object.keys(r.photos)).toEqual(["c"]);
  });
});

describe("titleVariants: safe, bounded spellings", () => {
  it("offers the name, the name without brackets, the part before a comma, and without Sri/Shri", () => {
    expect(titleVariants("Sri Kanaka Durga Temple, Vijayawada")).toEqual(["Sri Kanaka Durga Temple, Vijayawada", "Sri Kanaka Durga Temple", "Kanaka Durga Temple"]);
    expect(titleVariants("Golconda Fort (Hyderabad)")).toContain("Golconda Fort");
    expect(titleVariants("charminar")).toContain("Charminar"); // typed in lower case
  });
  it("never produces a title that could change the request (pipes, hashes, brackets) and is bounded", () => {
    for (const bad of ["Fort | Temple", "Fort#1", "A<B>", "[x]", "{y}", "a\u0000b"]) expect(titleVariants(bad).every((v) => !/[|#<>[\]{}\u0000]/.test(v))).toBe(true);
    expect(titleVariants("Fort | Temple, Place")).toEqual([]); // every spelling of it contains a pipe, so nothing is offered
    expect(titleVariants("x".repeat(300))).toEqual([]);
    expect(titleVariants("A, B (C), Sri D").length).toBeLessThanOrEqual(4);
  });
});

describe("licence alternatives: a free photo is not refused because it is ALSO offered under another licence", () => {
  it.each([["CC BY-SA 3.0, GFDL"], ["GFDL 1.2 or later / CC BY-SA 3.0"], ["CC BY-SA 3.0, 2.5, 2.0, 1.0"]])("accepts %s and credits the acceptable alternative", async (licence) => {
    const w = wiki({ ...baseWorld(), files: { "Charminar_Hyderabad.jpg": { licence } } });
    const r = await resolvePlacePhotos([charminar], deps(w.get));
    expect(r.photos.c?.licence).toMatch(/^CC BY-SA 3\.0$/);
  });
  it("uses Commons' machine-readable licence code when the display name is unreadable", async () => {
    const w = wiki({ ...baseWorld(), files: { "Charminar_Hyderabad.jpg": { licence: "Own work, see description", code: "cc-by-sa-4.0" } } });
    expect((await resolvePlacePhotos([charminar], deps(w.get))).photos.c?.licence).toBe("CC BY-SA 4.0");
  });
  it.each([["GFDL 1.2"], ["CC BY-NC 4.0"], ["CC BY-SA 3.0 and CC BY-NC 3.0"], ["Fair use"]])("still refuses %s", async (licence) => {
    const w = wiki({ ...baseWorld(), files: { "Charminar_Hyderabad.jpg": { licence } } });
    const r = await resolvePlacePhotos([charminar], deps(w.get));
    expect(r.photos).toEqual({});
    expect(r.reasons.c).toBe("licence");
  });
});

describe("Commons tier: photos geotagged next to the place, matched by name", () => {
  const golconda = q("g", "Golconda Fort", 17.3833, 78.4011);
  const articleWorld = (over: Partial<World> = {}): World => ({
    pages: { Golconda: { lat: 17.3833, lng: 78.4011, file: "Golconda_map.svg" } }, redirects: { "Golconda Fort": "Golconda" },
    files: { "Golconda_Fort_gate.jpg": {} }, ...over,
  });
  it("rescues a place whose article's own images all fail, using a geotagged Commons file that carries the place's name", async () => {
    const w = wiki(articleWorld({ commonsGeo: [{ file: "Golconda_Fort_gate.jpg", lat: 17.3834, lng: 78.4012 }] }));
    const r = await resolvePlacePhotos([golconda], deps(w.get));
    expect(r.photos.g).toMatchObject({ source: "commons", via: "commons", file: "Golconda_Fort_gate.jpg", licence: "CC BY-SA 4.0", pageUrl: "https://commons.wikimedia.org/wiki/File:Golconda_Fort_gate.jpg", title: "Golconda" });
    expect(r.trails.g.join("\n")).toContain("photo CHOSEN");
  });
  it("works for a place with NO Wikipedia article at all (typical small temple), within 500 m of the pin", async () => {
    const w = wiki({ files: { "Ramalayam_Temple_Karimnagar.jpg": {} }, commonsGeo: [{ file: "Ramalayam_Temple_Karimnagar.jpg", lat: 18.4401, lng: 79.1301 }] });
    const r = await resolvePlacePhotos([q("t", "Ramalayam Temple", 18.44, 79.13)], deps(w.get));
    expect(r.photos.t).toMatchObject({ source: "commons", file: "Ramalayam_Temple_Karimnagar.jpg", title: "Ramalayam Temple" });
    expect(r.unresolved).toEqual([]);
  });
  it("WITHOUT an article, refuses a file that is geotagged too far away, or whose name does not carry the place's name", async () => {
    const w = wiki({ files: { "Ramalayam_Temple_far.jpg": {}, "Random_street_scene.jpg": {} }, commonsGeo: [{ file: "Ramalayam_Temple_far.jpg", lat: 18.46, lng: 79.13 }, { file: "Random_street_scene.jpg", lat: 18.44, lng: 79.13 }] });
    const r = await resolvePlacePhotos([q("t", "Ramalayam Temple", 18.44, 79.13)], deps(w.get));
    expect(r.photos).toEqual({});
    expect(r.reasons.t).toBe("no_page"); // honest: nothing identified this place
  });
  it("a name-search hit with no geotag is NOT enough on its own (wrong-photo risk), but is accepted when a verified article vouches for the place", async () => {
    const files = { "Ramalayam_Temple_view.jpg": {} };
    const none = await resolvePlacePhotos([q("t", "Ramalayam Temple", 18.44, 79.13)], deps(wiki({ files, commonsSearch: { "Ramalayam Temple": [{ file: "Ramalayam_Temple_view.jpg" }] } }).get));
    expect(none.photos).toEqual({});
    const vouched = await resolvePlacePhotos([q("t", "Ramalayam Temple", 18.44, 79.13)], deps(wiki({ files, pages: { "Ramalayam Temple": { lat: 18.44, lng: 79.13 } }, commonsSearch: { "Ramalayam Temple": [{ file: "Ramalayam_Temple_view.jpg" }] } }).get));
    expect(vouched.photos.t).toMatchObject({ source: "commons", file: "Ramalayam_Temple_view.jpg" });
  });
  it("the article's own lead image still wins when it is usable (Commons is only the fallback)", async () => {
    const w = wiki({ ...baseWorld(), files: { "Charminar_Hyderabad.jpg": {}, "Charminar_night.jpg": {} }, commonsGeo: [{ file: "Charminar_night.jpg", lat: 17.3616, lng: 78.4747 }] });
    const r = await resolvePlacePhotos([charminar], deps(w.get));
    expect(r.photos.c).toMatchObject({ source: "wikipedia", file: "Charminar_Hyderabad.jpg" });
    expect(w.calls.commonsGeo + w.calls.commonsSearch).toBe(0); // no extra requests for a place that is already settled
  });
  it("never shows a Commons file that is not freely licensed, a map, or too small", async () => {
    const w = wiki({ files: { "Ramalayam_Temple_NC.jpg": { licence: "CC BY-NC 4.0" }, "Ramalayam_Temple_map.jpg": {}, "Ramalayam_Temple_tiny.jpg": { w: 200, h: 150 } },
      commonsGeo: ["Ramalayam_Temple_NC.jpg", "Ramalayam_Temple_map.jpg", "Ramalayam_Temple_tiny.jpg"].map((file) => ({ file, lat: 18.44, lng: 79.13 })) });
    const r = await resolvePlacePhotos([q("t", "Ramalayam Temple", 18.44, 79.13)], deps(w.get));
    expect(r.photos).toEqual({});
  });
  it("a Commons outage is 'could not check', never 'no photo', and nothing is cached as none", async () => {
    const store = new MemoryPhotoStore();
    const w = wiki({}, { commonsGeo: true, commonsSearch: true });
    const r = await resolvePlacePhotos([q("t", "Ramalayam Temple", 18.44, 79.13)], deps(w.get, { store }));
    expect(r.unresolved).toEqual(["t"]);
    expect((await store.getMany([...(await store.getMany([]))].map(([k]) => k))).size).toBe(0);
  });
  it.each([["the geotag lookup", { commonsGeo: true }], ["the name search", { commonsSearch: true }]])("if only %s fails, the place is 'could not check' (unresolved, not cached), never 'no photo'", async (_n, fail) => {
    const store = new MemoryPhotoStore();
    const w = wiki({}, fail);
    const r = await resolvePlacePhotos([q("t", "Ramalayam Temple", 18.44, 79.13)], deps(w.get, { store }));
    expect(r.unresolved).toEqual(["t"]);
    expect(r.reasons).toEqual({});
    expect((await store.getMany([photoKey("Ramalayam Temple", 18.44, 79.13)])).size).toBe(0);
  });
  it("bounds the extra work: at most 20 places get the Commons look in one call, the rest are 'ask again later' (not cached as none)", async () => {
    const qs = Array.from({ length: 25 }, (_, i) => q(`k${i}`, `Zzyzx Temple${i}`, 10 + i * 0.5, 70));
    const w = wiki({});
    const r = await resolvePlacePhotos(qs, deps(w.get, { maxLookups: 25 }));
    expect(w.calls.commonsSearch).toBeLessThanOrEqual(20);
    expect(r.unresolved.length).toBe(5);
  });
});

describe("diagnostics bypass every cache", () => {
  it("skipCache looks the place up again even when the shared cache has an answer, and still returns the trail", async () => {
    const store = new MemoryPhotoStore();
    await resolvePlacePhotos([charminar], deps(wiki({ pages: {}, files: {} }).get, { store })); // caches "none"
    const w = wiki(baseWorld());
    const cached = await resolvePlacePhotos([charminar], deps(w.get, { store }));
    expect(cached.photos).toEqual({}); expect(cached.trails).toEqual({}); // the old answer sticks, with no trail (that was the confusing part)
    const fresh = await resolvePlacePhotos([charminar], deps(w.get, { store, skipCache: true }));
    expect(fresh.photos.c?.title).toBe("Charminar");
    expect(fresh.trails.c.length).toBeGreaterThan(0);
  });
  it("skipCache also forgets remembered licence verdicts (a wrongly remembered 'not free' cannot hide a photo)", async () => {
    await resolvePlacePhotos([charminar], deps(wiki({ ...baseWorld(), files: { "Charminar_Hyderabad.jpg": { licence: "GFDL 1.2" } } }).get));
    const w = wiki(baseWorld());
    expect((await resolvePlacePhotos([charminar], deps(w.get, { store: new MemoryPhotoStore() }))).photos).toEqual({}); // remembered for 24 h
    expect((await resolvePlacePhotos([charminar], deps(w.get, { store: new MemoryPhotoStore(), skipCache: true }))).photos.c).toBeDefined();
  });
});

describe("real-world shape: Commons sends the original address but no thumburl for large files", () => {
  it("still finds the photo (this is what hid every large image, e.g. Charminar, until Update 62)", async () => {
    const w = wiki({ ...baseWorld(), files: { "Charminar_Hyderabad.jpg": { noThumb: true, w: 4000, h: 3000 } } });
    const r = await resolvePlacePhotos([charminar], deps(w.get));
    expect(r.photos.c?.url).toContain("/wikipedia/commons/thumb/a/ab/Charminar_Hyderabad.jpg/");
    expect(r.photos.c?.srcSet).toContain("120w");
  });
});
