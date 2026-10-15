import { describe, expect, it } from "vitest";
import { chooseBest, explainCandidates, scoreFile, sharesDistinctiveWord, type FileCandidate } from "@/lib/place-photos/rank";
import { fileKey, type FileMeta } from "@/lib/place-photos/commons-meta";

const meta = (file: string, o: Partial<FileMeta> = {}): FileMeta => ({
  licence: "CC BY-SA 4.0", licenceUrl: null, author: "A", creditUrl: `https://commons.wikimedia.org/wiki/File:${file}`,
  thumbUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/500px-${file}`, thumbWidth: 500, thumbHeight: 333, width: 2000, height: 1333, ...o,
});
const world = (entries: Record<string, FileMeta | null>) => new Map(Object.entries(entries).map(([f, m]) => [fileKey(f), m]));
const place = { name: "Golconda Fort" };
const lead = (file: string): FileCandidate => ({ file, source: "lead" });

describe("sharesDistinctiveWord: article images must name the place", () => {
  it("true when a distinctive word of the name is in the file name", () => {
    expect(sharesDistinctiveWord("Golconda Fort", "Golconda_Fort_gate_2019.jpg")).toBe(true);
    expect(sharesDistinctiveWord("Sri Kanaka Durga Temple", "Kanaka-Durga-Vijayawada.jpg")).toBe(true);
  });
  it("false for a portrait of a king, generic words, or a name with nothing distinctive", () => {
    expect(sharesDistinctiveWord("Golconda Fort", "Abdullah_Qutb_Shah_portrait.jpg")).toBe(false);
    expect(sharesDistinctiveWord("Golconda Fort", "Fort_wall.jpg")).toBe(false); // "fort" is a kind of place, not an identity
    expect(sharesDistinctiveWord("Temple", "Temple.jpg")).toBe(false);
    expect(sharesDistinctiveWord("Om Temple", "Om.jpg")).toBe(false); // too short to trust
  });
});

describe("chooseBest: hard gates", () => {
  it("picks a clean lead photo", () => {
    const r = chooseBest(place, [lead("Golconda.jpg")], world({ "Golconda.jpg": meta("Golconda.jpg") }));
    expect("best" in r && r.best.file).toBe("Golconda.jpg");
  });
  it("rejects maps/flags by name, svg, and non-Commons thumbnail addresses", () => {
    const bad = meta("Golconda.jpg", { thumbUrl: "https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/Golconda.jpg/500px-Golconda.jpg" });
    expect(chooseBest(place, [lead("Golconda_locator_map.png")], world({ "Golconda_locator_map.png": meta("Golconda_locator_map.png") }))).toEqual({ rejected: "image_rejected" });
    expect(chooseBest(place, [lead("Golconda.svg")], world({ "Golconda.svg": meta("Golconda.svg") }))).toEqual({ rejected: "image_rejected" });
    expect(chooseBest(place, [lead("Golconda.jpg")], world({ "Golconda.jpg": bad }))).toEqual({ rejected: "image_rejected" });
    expect(chooseBest(place, [lead("Golconda.jpg")], world({ "Golconda.jpg": { ...meta("Golconda.jpg"), thumbUrl: undefined } }))).toEqual({ rejected: "image_rejected" });
  });
  it("licence gate: Commons said it is not freely licensed → 'licence', not 'no photo exists'", () => {
    expect(chooseBest(place, [lead("Golconda.jpg")], world({ "Golconda.jpg": null }))).toEqual({ rejected: "licence" });
  });
  it("a file we never looked up is not usable (unknown is not 'free')", () => {
    expect(chooseBest(place, [lead("Golconda.jpg")], world({}))).toEqual({ rejected: "image_rejected" });
  });
  it("no candidates at all is reported as such", () => expect(chooseBest(place, [], world({}))).toEqual({ rejected: "no_image" }));
  it("tiny images are not shown as the face of a place", () => {
    expect(chooseBest(place, [lead("Golconda.jpg")], world({ "Golconda.jpg": meta("Golconda.jpg", { width: 120, height: 90, thumbWidth: 120, thumbHeight: 90 }) }))).toEqual({ rejected: "image_rejected" });
  });
  it("article images only count when the file name carries the place's name", () => {
    const f = { "King_portrait.jpg": meta("King_portrait.jpg"), "Golconda_ramparts.jpg": meta("Golconda_ramparts.jpg") };
    const art = (file: string): FileCandidate => ({ file, source: "article" });
    expect(chooseBest(place, [art("King_portrait.jpg")], world(f))).toEqual({ rejected: "image_rejected" });
    const r = chooseBest(place, [art("King_portrait.jpg"), art("Golconda_ramparts.jpg")], world(f));
    expect("best" in r && r.best.file).toBe("Golconda_ramparts.jpg");
  });
});

describe("chooseBest: ranking", () => {
  const ok = (file: string, o: Partial<FileMeta> = {}) => [file, meta(file, o)] as const;
  it("trusts the lead image over Wikidata's image over article images, all else equal", () => {
    const m = world(Object.fromEntries([ok("L.jpg"), ok("W.jpg"), ok("Golconda_a.jpg")]));
    const r = chooseBest(place, [{ file: "Golconda_a.jpg", source: "article" }, { file: "W.jpg", source: "wikidata" }, { file: "L.jpg", source: "lead" }], m);
    expect("best" in r && r.best.file).toBe("L.jpg");
  });
  it("prefers landscape over a tall crop, and a large file over a small one", () => {
    const tall = meta("Tall.jpg", { width: 1000, height: 1800 });
    const wide = meta("Wide.jpg", { width: 1600, height: 900 });
    expect(scoreFile({ file: "Wide.jpg", source: "wikidata" }, wide, 0)).toBeGreaterThan(scoreFile({ file: "Tall.jpg", source: "wikidata" }, tall, 0));
    const r = chooseBest(place, [{ file: "Tall.jpg", source: "wikidata" }, { file: "Wide.jpg", source: "wikidata" }], world({ "Tall.jpg": tall, "Wide.jpg": wide }));
    expect("best" in r && r.best.file).toBe("Wide.jpg");
  });
  it("a landscape Wikidata photo beats a portrait lead photo (it fits the cards the app shows)", () => {
    const m = world({ "Lead.jpg": meta("Lead.jpg", { width: 900, height: 1500 }), "Wd.jpg": meta("Wd.jpg", { width: 1800, height: 1000 }) });
    const r = chooseBest(place, [lead("Lead.jpg"), { file: "Wd.jpg", source: "wikidata" }], m);
    expect("best" in r && r.best.file).toBe("Wd.jpg");
  });
  it("is deterministic and ignores duplicates of the same file under different spellings", () => {
    const m = world({ "A b.jpg": meta("A_b.jpg") });
    const c: FileCandidate[] = [lead("A_b.jpg"), { file: "A b.jpg", source: "wikidata" }];
    expect(chooseBest(place, c, m)).toEqual(chooseBest(place, c, m));
  });
});

describe("explainCandidates: the diagnostic can never disagree with the decision", () => {
  const files: [string, FileCandidate["source"], FileMeta | null | undefined][] = [
    ["Golconda_Fort.jpg", "lead", meta("Golconda_Fort.jpg")],
    ["Golconda_locator_map.png", "lead", meta("Golconda_locator_map.png")],
    ["King_portrait.jpg", "article", meta("King_portrait.jpg")],
    ["Golconda_unfree.jpg", "wikidata", null],
    ["Golconda_unseen.jpg", "wikidata", undefined],
    ["Golconda_tiny.jpg", "lead", meta("Golconda_tiny.jpg", { width: 100, height: 80, thumbWidth: 100, thumbHeight: 80 })],
    ["Golconda.svg", "lead", meta("Golconda.svg")],
  ];
  it("every candidate gets exactly one line, and a line says OK exactly when chooseBest would accept that file alone", () => {
    for (const [file, source, m] of files) {
      const info = m === undefined ? world({}) : world({ [file]: m });
      const c: FileCandidate = { file, source };
      const line = explainCandidates(place, [c], info)[0];
      const accepted = "best" in chooseBest(place, [c], info);
      expect(line.includes(`"${file}": OK`)).toBe(accepted);
      expect(line.includes("rejected:")).toBe(!accepted);
    }
  });
  it("uses the reason Commons gave for an unusable file", () => {
    const why = new Map([[fileKey("Golconda_unfree.jpg"), 'licence "GFDL 1.2" is not on our free-licence list']]);
    expect(explainCandidates(place, [{ file: "Golconda_unfree.jpg", source: "wikidata" }], world({ "Golconda_unfree.jpg": null }), why)[0]).toContain('licence "GFDL 1.2"');
  });
  it("says so plainly when there is nothing to judge, and skips duplicate spellings", () => {
    expect(explainCandidates(place, [], world({}))[0]).toContain("no candidate image files at all");
    const m = world({ "A b.jpg": meta("A_b.jpg") });
    expect(explainCandidates({ name: "A" }, [lead("A_b.jpg"), { file: "A b.jpg", source: "wikidata" }], m)).toHaveLength(1);
  });
});

describe("Commons sources", () => {
  const geo = (file: string): FileCandidate => ({ file, source: "commons_geo" });
  it("a Commons photo needs the place's name in its file name, like an article image", () => {
    const r = chooseBest(place, [geo("Street_scene.jpg")], world({ "Street_scene.jpg": meta("Street_scene.jpg") }));
    expect(r).toEqual({ rejected: "image_rejected" });
    expect(explainCandidates(place, [geo("Street_scene.jpg")], world({ "Street_scene.jpg": meta("Street_scene.jpg") }))[0]).toContain("does not mention the place");
  });
  it("is chosen when it is all there is, with the 600 px minimum", () => {
    const f = "Golconda_Fort_gate.jpg";
    expect("best" in chooseBest(place, [geo(f)], world({ [f]: meta(f) }))).toBe(true);
    expect(chooseBest(place, [geo(f)], world({ [f]: meta(f, { width: 500, thumbWidth: 500 }) }))).toEqual({ rejected: "image_rejected" });
  });
  it("ranks below an usable lead image and Wikidata's image, above other article images", () => {
    const l = "Golconda_Fort_lead.jpg", c = "Golconda_Fort_gate.jpg", a = "Golconda_Fort_wall.jpg";
    const m = world({ [l]: meta(l), [c]: meta(c), [a]: meta(a) });
    expect((chooseBest(place, [geo(c), { file: a, source: "article" }, lead(l)], m) as { best: { file: string } }).best.file).toBe(l);
    expect((chooseBest(place, [{ file: a, source: "article" }, geo(c)], m) as { best: { file: string } }).best.file).toBe(c);
    expect((chooseBest(place, [{ file: c, source: "commons_name" }, { file: a, source: "article" }], m) as { best: { file: string } }).best.file).toBe(a);
  });
  it("still never accepts a non-free Commons file", () => {
    const f = "Golconda_Fort_gate.jpg";
    expect(chooseBest(place, [geo(f)], world({ [f]: null }))).toEqual({ rejected: "licence" });
  });
});
