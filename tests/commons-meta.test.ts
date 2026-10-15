import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearFileMetaCache, fetchFileMeta, fileKey, parseFileMeta, parseFileMetaDetailed } from "@/lib/place-photos/commons-meta";

const ext = (o: { licence?: string; url?: string; artist?: string; nonFree?: string } = {}) => ({
  LicenseShortName: { value: o.licence ?? "CC BY-SA 4.0" }, LicenseUrl: { value: o.url ?? "https://creativecommons.org/licenses/by-sa/4.0" },
  Artist: { value: o.artist ?? "<a href='//x'>Jane Doe</a>" }, ...(o.nonFree ? { NonFree: { value: o.nonFree } } : {}),
});
const page = (title: string, e = ext()) => ({ title, imageinfo: [{ extmetadata: e }] });
const ok = (pages: unknown[], extra: object = {}) => ({ query: { pages, ...extra } });

describe("fileKey", () => {
  it("treats underscores, spaces and the File: prefix as the same file", () => {
    expect(fileKey("Fort_gate.jpg")).toBe("File:Fort gate.jpg");
    expect(fileKey("File:Fort gate.jpg")).toBe("File:Fort gate.jpg");
    expect(fileKey("file:Fort_gate.jpg")).toBe("File:Fort gate.jpg");
  });
});

describe("parseFileMeta", () => {
  it("returns author, licence, licence link and file page for a free file", () => {
    expect(parseFileMeta({ query: { pages: [page("File:A b.jpg")] } }).get("File:A b.jpg")).toEqual({
      licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0", author: "Jane Doe", creditUrl: "https://commons.wikimedia.org/wiki/File:A_b.jpg",
      addressNote: expect.stringContaining("no usable Commons image address"), // this fixture has no image address at all, and says so
    });
  });
  it("is null (known: not usable) for non-free, unreadable or missing files", () => {
    const m = parseFileMeta({ query: { pages: [
      page("File:Nc.jpg", ext({ licence: "CC BY-NC 4.0" })), page("File:Nf.jpg", ext({ nonFree: "true" })), page("File:Empty.jpg", ext({ licence: "" })),
      { title: "File:Gone.jpg", missing: true }, { title: "File:NoMeta.jpg", imageinfo: [{}] },
    ] } });
    for (const k of ["Nc", "Nf", "Empty", "Gone", "NoMeta"]) expect(m.get(`File:${k}.jpg`)).toBeNull();
  });
  it("drops a licence link that is not Creative Commons, and unusable authors", () => {
    const m = parseFileMeta({ query: { pages: [page("File:A.jpg", ext({ url: "https://evil.example/l", artist: "<br>" }))] } }).get("File:A.jpg");
    expect(m).toMatchObject({ licenceUrl: null, author: null });
  });
  it("answers under the name we asked with when Commons normalised or redirected it", () => {
    const m = parseFileMeta({ query: { normalized: [{ from: "File:foo.jpg", to: "File:Foo.jpg" }], redirects: [{ from: "File:Foo.jpg", to: "File:Bar.jpg" }], pages: [page("File:Bar.jpg")] } });
    expect(m.get("File:foo.jpg")?.licence).toBe("CC BY-SA 4.0");
  });
  it("gives an empty map (= could not find out) for garbage", () => {
    for (const junk of [null, "x", 7, {}, { query: { pages: "no" } }, { query: {} }]) expect(parseFileMeta(junk).size).toBe(0);
  });
});

describe("parseFileMetaDetailed: says WHY a file cannot be used", () => {
  const why = (e: object, extra: object = {}) => parseFileMetaDetailed({ query: { pages: [{ title: "File:A.jpg", imageinfo: [{ extmetadata: e, ...extra }] }] } }).why.get("File:A.jpg");
  it("names the licence Commons reported", () => {
    expect(why(ext({ licence: "GFDL 1.2" }))).toBe('licence "GFDL 1.2" is not on our free-licence list');
    expect(why(ext({ licence: "CC BY-NC 4.0" }))).toBe('licence "CC BY-NC 4.0" is not on our free-licence list');
    expect(why(ext({ licence: "CC BY-SA 4.0", nonFree: "true" }))).toBe('marked non-free (licence "CC BY-SA 4.0")');
  });
  it("tells a file local to Wikipedia (missing on Commons) from a bad type or empty metadata", () => {
    expect(parseFileMetaDetailed({ query: { pages: [{ title: "File:A.jpg", missing: true }] } }).why.get("File:A.jpg")).toContain("not found on Wikimedia Commons");
    expect(why(ext(), { mime: "image/svg+xml" })).toBe("file type image/svg+xml is not a photo");
    expect(parseFileMetaDetailed({ query: { pages: [{ title: "File:A.jpg", imageinfo: [{}] }] } }).why.get("File:A.jpg")).toContain("no licence information");
  });
  it("has no reason for a usable file, and the reason follows a redirect to the name we asked with", () => {
    expect(why(ext())).toBeUndefined();
    const r = parseFileMetaDetailed({ query: { redirects: [{ from: "File:Old.jpg", to: "File:A.jpg" }], pages: [{ title: "File:A.jpg", imageinfo: [{ extmetadata: ext({ licence: "GFDL" }) }] }] } });
    expect(r.why.get("File:Old.jpg")).toContain("GFDL");
  });
});

describe("parseFileMeta: size and thumbnail (for ranking and sizing)", () => {
  const withInfo = (info: object, e = ext()) => ({ query: { pages: [{ title: "File:A.jpg", imageinfo: [{ extmetadata: e, ...info }] }] } });
  it("carries the 500 px thumbnail address and the original's size when Commons gave them", () => {
    const m = parseFileMeta(withInfo({ thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/500px-A.jpg", thumbwidth: 500, thumbheight: 333, width: 3000, height: 2000, mime: "image/jpeg" })).get("File:A.jpg");
    expect(m).toMatchObject({ thumbUrl: expect.stringContaining("500px-A.jpg"), thumbWidth: 500, thumbHeight: 333, width: 3000, height: 2000 });
  });
  it("a file whose type is not a raster photo (svg, pdf, video) is not usable even with a free licence", () => {
    for (const mime of ["image/svg+xml", "application/pdf", "video/webm", "image/tiff"]) expect(parseFileMeta(withInfo({ mime })).get("File:A.jpg")).toBeNull();
  });
});

describe("fetchFileMeta", () => {
  it("asks for the sizes and a 500 px rendition in the same single request", async () => {
    clearFileMetaCache();
    const f = vi.fn<(url: string) => Promise<unknown>>(async () => ok([page("File:A.jpg")]));
    await fetchFileMeta(["A.jpg"], f);
    const q = new URL(f.mock.calls[0][0]).searchParams;
    expect(q.get("iiprop")).toBe("extmetadata|size|mime|url");
    expect(q.get("iiurlwidth")).toBe("500");
  });
  it("asks Commons to follow file redirects (a name that redirects used to look like 'not found')", async () => {
    clearFileMetaCache();
    const f = vi.fn<(url: string) => Promise<unknown>>(async () => ok([page("File:A.jpg")]));
    await fetchFileMeta(["A.jpg"], f);
    expect(new URL(f.mock.calls[0][0]).searchParams.get("redirects")).toBe("1");
  });
  it("hands back the reason for each refused file, also when it was served from the cache", async () => {
    clearFileMetaCache();
    const f = vi.fn<(url: string) => Promise<unknown>>(async () => ok([page("File:A.jpg", ext({ licence: "GFDL 1.2" }))]));
    const first = new Map<string, string>();
    await fetchFileMeta(["A.jpg"], f, Date.now, first);
    const again = new Map<string, string>();
    await fetchFileMeta(["A.jpg"], f, Date.now, again);
    expect(f).toHaveBeenCalledTimes(1);
    expect(again.get("File:A.jpg")).toBe(first.get("File:A.jpg"));
    expect(again.get("File:A.jpg")).toContain("GFDL 1.2");
  });
  beforeEach(() => clearFileMetaCache());

  it("batches 50 files per request and caches what it learns", async () => {
    const files = Array.from({ length: 120 }, (_, i) => `F${i}.jpg`);
    const f = vi.fn(async (url: string) => {
      const titles = new URL(url).searchParams.get("titles")!.split("|");
      return ok(titles.map((t) => page(t)));
    });
    const out = await fetchFileMeta(files, f);
    expect(f).toHaveBeenCalledTimes(3); // 50 + 50 + 20
    expect(out.size).toBe(120);
    await fetchFileMeta(files, f);
    expect(f).toHaveBeenCalledTimes(3); // all served from cache
  });
  it("asks about each distinct file once, however it is spelled", async () => {
    const f = vi.fn<(url: string) => Promise<unknown>>(async () => ok([page("File:A b.jpg")]));
    await fetchFileMeta(["A_b.jpg", "File:A b.jpg", "A b.jpg"], f);
    expect(new URL(f.mock.calls[0][0]).searchParams.get("titles")).toBe("File:A b.jpg");
  });
  it("remembers 'not free' (null) so it is not asked again", async () => {
    const f = vi.fn(async () => ok([page("File:A.jpg", ext({ licence: "CC BY-NC 4.0" }))]));
    expect((await fetchFileMeta(["A.jpg"], f)).get("File:A.jpg")).toBeNull();
    await fetchFileMeta(["A.jpg"], f);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("a failure leaves files UNRESOLVED (absent), is not cached, and one bad batch does not lose the others", async () => {
    clearFileMetaCache();
    let calls = 0;
    const f = vi.fn(async (url: string) => {
      calls++;
      if (calls === 1) return null; // the client gave up on this batch (e.g. rate limited)
      return ok(new URL(url).searchParams.get("titles")!.split("|").map((t) => page(t)));
    });
    const files = Array.from({ length: 60 }, (_, i) => `F${i}.jpg`);
    const out = await fetchFileMeta(files, f);
    expect(out.has("File:F0.jpg")).toBe(false); // first batch failed: unknown, NOT "not free"
    expect(out.has("File:F59.jpg")).toBe(true); // second batch succeeded
    const retry = await fetchFileMeta(files, f);
    expect(retry.has("File:F0.jpg")).toBe(true); // asked again, nothing was poisoned
  });
  it("treats a missing answer or an unreadable one as unresolved, and never throws", async () => {
    for (const f of [async () => null, async () => "<html>", async () => ({}), async () => ok([])]) {
      clearFileMetaCache();
      expect((await fetchFileMeta(["A.jpg"], f)).has("File:A.jpg")).toBe(false);
    }
  });
});

describe("licence alternatives and codes in a real-shaped Commons answer", () => {
  const meta = (e: object) => parseFileMetaDetailed(ok([{ title: "File:X.jpg", imageinfo: [{ thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/500px-X.jpg", extmetadata: e }] }]));
  it("accepts a dual-licensed file and credits the acceptable licence", () => {
    expect(meta({ LicenseShortName: { value: "CC BY-SA 3.0, GFDL" } }).meta.get("File:X.jpg")?.licence).toBe("CC BY-SA 3.0");
  });
  it("falls back to the machine code when the display name is not on our list", () => {
    expect(meta({ LicenseShortName: { value: "Own work" }, License: { value: "cc-by-4.0" } }).meta.get("File:X.jpg")?.licence).toBe("CC BY 4.0");
  });
  it("keeps refusing GFDL-only files, and says which licence and code it saw", () => {
    const r = meta({ LicenseShortName: { value: "GFDL 1.2" }, License: { value: "gfdl" } });
    expect(r.meta.get("File:X.jpg")).toBeNull();
    expect(r.why.get("File:X.jpg")).toContain("GFDL 1.2");
    expect(r.why.get("File:X.jpg")).toContain("gfdl");
  });
  it("a file marked non-free is refused even if its name says CC", () => {
    expect(meta({ LicenseShortName: { value: "CC BY-SA 4.0" }, NonFree: { value: "true" } }).meta.get("File:X.jpg")).toBeNull();
  });
  it("asks Commons for the machine licence code too", async () => {
    let asked = "";
    await fetchFileMeta(["A.jpg"], async (u) => { asked = u; return null; });
    expect(new URL(asked).searchParams.get("iiextmetadatafilter")).toContain("License|");
  });
});

describe("image address: what Commons really sends for large originals", () => {
  const ORIG = "https://upload.wikimedia.org/wikipedia/commons/c/c9/Charminar_Hyderabad_1.jpg";
  const one = (info: object) => parseFileMeta(ok([{ title: "File:Charminar Hyderabad 1.jpg", imageinfo: [{ extmetadata: ext(), ...info }] }])).get("File:Charminar Hyderabad 1.jpg");
  it("derives the standard 500 px thumbnail from the ORIGINAL address when Commons sent no usable thumburl", () => {
    const m = one({ url: ORIG, width: 4000, height: 3000 });
    expect(m?.thumbUrl).toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Charminar_Hyderabad_1.jpg/500px-Charminar_Hyderabad_1.jpg");
    expect(m).toMatchObject({ thumbWidth: 500, thumbHeight: 375, width: 4000, height: 3000 });
    expect(m?.addressNote).toBeUndefined();
  });
  it("also when the thumburl Commons sent is not an address we accept (other host, other wiki)", () => {
    for (const thumburl of ["https://evil.example/x.jpg", "https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/X.jpg/500px-X.jpg", "not a url"]) {
      expect(one({ thumburl, url: ORIG, width: 4000, height: 3000 })?.thumbUrl).toContain("/wikipedia/commons/thumb/c/c9/");
    }
  });
  it("prefers Commons' own thumburl when it is a valid Commons address (query suffix included)", () => {
    const t = "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Charminar_Hyderabad_1.jpg/500px-Charminar_Hyderabad_1.jpg?utm_source=commons.wikimedia.org";
    expect(one({ thumburl: t, thumbwidth: 500, thumbheight: 375, url: ORIG, width: 4000, height: 3000 })?.thumbUrl).toBe(t);
  });
  it("uses a small original as it is (never asks Wikimedia to upscale), as Kondapalli's already worked", () => {
    const m = one({ url: ORIG, width: 480, height: 340 });
    expect(m).toMatchObject({ thumbUrl: ORIG, thumbWidth: 480, thumbHeight: 340 });
  });
  it("never invents an address from a foreign or non-Commons original, and says what Commons sent", () => {
    for (const url of ["https://evil.example/a/ab/X.jpg", "https://upload.wikimedia.org/wikipedia/en/a/ab/X.jpg", undefined]) {
      const m = one({ url, width: 4000, height: 3000 });
      expect(m?.thumbUrl).toBeUndefined();
      expect(m?.addressNote).toContain("no usable Commons image address");
    }
  });
  it("without the original's width nothing can be derived (we would not know what may be asked for)", () => {
    expect(one({ url: ORIG })?.thumbUrl).toBeUndefined();
  });
});
