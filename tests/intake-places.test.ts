import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildIndex, type GeoIndexData } from "@/lib/places/geo-index";
import { namesMatch, resolvePlaces, resolveStart, type ResolveDeps } from "@/lib/intake/places";
import { readInstant, readWithAi } from "@/lib/intake/service";
import { AiNotConfiguredError, AiRequestError } from "@/lib/ai/types";
import type { PlaceHit } from "@/lib/places/types";
import type { SaidPlace } from "@/lib/intake/types";

// A small India built from the REAL cases we met with the full index (GeoNames data, including its quirks).
const DATA: GeoIndexData = {
  version: 1, source: "test", built: "x",
  states: ["Telangana", "Andhra Pradesh", "Kerala", "Maharashtra", "Goa", "Karnataka"],
  districts: ["Hyderabad", "Hanamkonda", "Warangal Rural", "NTR", "Sri Sathya Sai", "Idukki", "Palghar", "Nandyal", "Pune", "South Goa", "Chikmagalur"],
  rows: [
    ["Hyderabad", 17.385, 78.4867, "city", 0, 0, 6993262, ["HYD", "హైదరాబాదు", "हैदराबाद"]],
    ["Warangal", 18.0, 79.58333, "city", 0, 1, 704570, ["Orugallu", "వరంగల్"]],
    ["Warangal Fort", 17.95, 79.61667, "sight", 0, 2, 0],
    ["Warangal", 17.98, 79.6, "subdistrict", 0, 2, 297078],
    ["Kondapalle", 16.61989, 80.54244, "town", 1, 3, 30000, ["Kondapalli"]],
    ["Kondapalli", 14.53126, 77.40308, "hill", 1, 4, 0],
    ["Munnar", 10.0889, 77.0595, "town", 2, 5, 68000, ["मुन्नार"]],
    ["Manor", 19.73, 72.91, "town", 3, 6, 10421, ["Munnar"]], // GeoNames really lists "Munnar" as another name of Manor (Maharashtra)
    ["Srisailain", 16.07, 78.87, "town", 1, 7, 24142, ["Srisailam"]],
    ["Srisailam", 16.1, 78.9, "subdistrict", 1, 7, 31834],
    ["Lonavla", 18.75, 73.4, "town", 3, 8, 57698, ["Lonavala"]],
    ["Ramappa Cheruvu", 18.25, 79.95, "water", 0, 1, 0, ["Ramappa Lake"]],
    ["Goa", 15.3, 74.08, "state", 4, -1, 1457723, ["गोवा", "గోవా"]],
    ["Mormugao", 15.4, 73.8, "city", 4, 9, 102345, ["Goa"]],
    ["Chikmagalur", 13.31, 75.77, "city", 5, 10, 118000],
    ["Chikmagalur", 13.4, 75.7, "district", 5, -1, 1137961],
    ["Bengaluru", 12.97, 77.59, "city", 5, -1, 8495492, ["Bangalore", "ಬೆಂಗಳೂರು", "பெங்களூர்"]],
  ],
};
const ix = buildIndex(DATA);
const said = (s: string, source: "said" | "ai" = "said"): SaidPlace => ({ said: s, must: false, source, evidence: s });
const osm = (name: string, lat: number, lng: number, kind: PlaceHit["kind"] = "sight"): PlaceHit => ({ id: `osm:${name}:${lat}`, name, lat, lng, kind, area: "Telangana", state: "Telangana", source: "osm" });
const HYD = { lat: 17.385, lng: 78.4867, name: "Hyderabad" };

let deps: ResolveDeps & { photon: ReturnType<typeof vi.fn>; allow: ReturnType<typeof vi.fn> };
beforeEach(() => { deps = { index: async () => ix, photon: vi.fn(async () => []), allow: vi.fn(async () => true) }; });
const one = async (name: string, start: typeof HYD | null = HYD, source: "said" | "ai" = "said") => (await resolvePlaces([said(name, source)], { start }, deps))[0];

describe("matching what was written to real places — sure / check / missing", () => {
  it("a town's name, not the fort named after it", async () => {
    expect(await one("Warangal")).toMatchObject({ status: "sure", place: { name: "Warangal", kind: "city" } });
  });
  it("our list's own name beats a wrong 'other name' (GeoNames calls Manor 'Munnar')", async () => {
    const m = await one("Munnar");
    expect(m.place).toMatchObject({ name: "Munnar", kind: "town" });
  });
  it("a spelling difference is still sure, and says which name the map uses", async () => {
    expect(await one("Lonavala")).toMatchObject({ status: "sure", place: { name: "Lonavla", calledAs: "Lonavala" } });
    expect((await one("Srisailam")).place).toMatchObject({ name: "Srisailain", kind: "town" }); // the temple town, not the mandal
  });
  it("a name shared by a hill and a town: 'check this', with both to choose from", async () => {
    const m = await one("Kondapalli", null);
    expect(m.status).toBe("check");
    expect(m.reason).toMatch(/2 places are called/);
    expect([m.place!, ...m.alternatives].map((o) => o.area)).toEqual(expect.arrayContaining(["NTR, Andhra Pradesh", "Sri Sathya Sai, Andhra Pradesh"]));
  });
  it("…but the trip's area clearly picks one: sure", async () => {
    const m = await one("Kondapalli", { lat: 16.5, lng: 80.64, name: "Vijayawada" });
    expect(m).toMatchObject({ status: "sure", place: { name: "Kondapalle" } });
  });
  it("a city and its own district are ONE place, not 'two called Chikmagalur'", async () => {
    expect(await one("Chikmagalur")).toMatchObject({ status: "sure", place: { kind: "city" } });
  });
  it("a whole state: 'check this', said plainly; its own name beats another city's other name", async () => {
    const m = await one("Goa");
    expect(m).toMatchObject({ status: "check", place: { kind: "state", name: "Goa" } });
    expect(m.reason).toMatch(/whole state/);
    expect((await one("గోవా")).place?.name).toBe("Goa"); // Telugu script, from GeoNames' own names
  });
  it("very far from the trip's other places: 'check this' with the distance", async () => {
    const ms = await resolvePlaces([said("Warangal"), said("Hyderabad", "ai"), said("Srisailam"), said("Munnar")], { start: null }, deps);
    const munnar = ms.find((m) => m.said === "Munnar")!;
    expect(munnar.status).toBe("check");
    expect(munnar.reason).toMatch(/km from your other places/);
  });
  it("the start city written among the places is the start, not a stop", async () => {
    const ms = await resolvePlaces([said("Hyderabad", "ai"), said("Warangal")], { start: HYD }, deps);
    expect(ms.map((m) => m.said)).toEqual(["Warangal"]);
  });
  it("not in our list → OpenStreetMap, exact name only; a temple is never a lake", async () => {
    deps.photon.mockResolvedValue([osm("Ramappa Temple", 18.259, 79.943), osm("Ramappa Temple", 18.2595, 79.9435), osm("Old ramappa temple", 18.1, 79.9)]);
    const m = await one("Ramappa temple");
    expect(m).toMatchObject({ status: "sure", place: { name: "Ramappa Temple" } }); // two points 50 m apart = one place; not "Ramappa Lake"
    expect(deps.allow).toHaveBeenCalledTimes(1);
  });
  it("one letter off on the map: 'check this', closest match named", async () => {
    deps.photon.mockResolvedValue([osm("Boghatha waterfalls", 18.6, 80.6, "water")]);
    const m = await one("Bogatha waterfall");
    expect(m.status).toBe("check");
    expect(m.reason).toMatch(/Closest match on the map: “Boghatha waterfalls”/);
  });
  it("nothing real: 'missing' with a search hint — never a guessed pin", async () => {
    expect(await one("Xyzzyville")).toMatchObject({ status: "missing", place: null });
  });
  it("map busy: says busy, not 'doesn't exist'; limit reached: says so and stops asking", async () => {
    deps.photon.mockRejectedValue(new Error("503"));
    expect((await one("Xyzzyville")).reason).toMatch(/busy/);
    deps.allow.mockResolvedValue(false);
    const ms = await resolvePlaces([said("Aaaaville"), said("Bbbbville")], { start: HYD }, deps);
    expect(ms.every((m) => /limit is used up/.test(m.reason ?? ""))).toBe(true);
    expect(deps.allow).toHaveBeenCalledTimes(2); // once refused, the second name is not even asked
  });
  it("Indian-script pieces that match nothing are grammar words: not listed as 'missing'", async () => {
    expect(await resolvePlaces([said("போகணும்")], { start: HYD }, deps)).toEqual([]);
    expect((await resolvePlaces([said("போகணும்", "ai")], { start: HYD }, deps))[0].status).toBe("missing"); // but an AI-read name is
  });
  it("name rules", () => {
    expect(namesMatch("Belum Caves", "Belum Caves")).toBe("exact");
    expect(namesMatch("Lepakshi temple", "Lepakshi")).toBe("exact");
    expect(namesMatch("Ramappa temple", "Ramappa Lake")).toBeNull();
    expect(namesMatch("Grand Canyon India", "Grand canyon of India")).toBe("loose");
  });
});

describe("where the trip starts", () => {
  it("the first written guess that is a real town, in any script", async () => {
    expect((await resolveStart(["4 rojulu Hyderabad", "Hyderabad"], deps)).place?.name).toBe("Hyderabad");
    expect((await resolveStart(["హైదరాబాద్"], deps)).place?.name).toBe("Hyderabad");
    // Kannada glues "from" onto the word: the reader leaves "ಬೆಂಗಳೂರ", GeoNames has "ಬೆಂಗಳೂರು" (found live, fixed, kept here).
    expect((await resolveStart(["ಬೆಂಗಳೂರ"], deps)).place?.name).toBe("Bengaluru");
    expect((await resolveStart(["Nowhere"], deps)).place).toBeNull();
  });
});

describe("the two readers end to end (fakes for the outside services)", () => {
  it("instant: answers + start + places, no AI involved", async () => {
    const a = await readInstant("4 rojulu Hyderabad nundi: Warangal, Ramappa temple", null, deps);
    expect(a.understanding.answers.days?.value).toBe(4);
    expect(a.start).toMatchObject({ from: "text", place: { name: "Hyderabad" } });
    expect(a.places.map((p) => p.said)).toEqual(["Warangal", "Ramappa temple"]);
  });
  it("a start chosen with the picker wins over the words", async () => {
    const a = await readInstant("from Warangal", { lat: 16.5, lng: 80.64, name: "Vijayawada" }, deps);
    expect(a.start).toMatchObject({ from: "you", place: { name: "Vijayawada" } });
  });
  it("AI statuses: limit, off, busy, slow, failed — each a plain status, never an error", async () => {
    const run = (llm: () => Promise<unknown>, allowAi = true, timeoutMs = 12_000) => readWithAi("4 days", null, { ...deps, llm: llm as never, allowAi: async () => allowAi, timeoutMs });
    expect((await run(async () => ({}), false)).status).toBe("limit");
    expect((await run(async () => { throw new AiNotConfiguredError("GEMINI_API_KEY"); })).status).toBe("off");
    expect((await run(async () => { throw new AiRequestError("rate", 429); })).status).toBe("busy");
    expect((await run(async () => { throw new Error("boom"); })).status).toBe("failed");
    expect((await run(() => new Promise(() => {}), true, 20)).status).toBe("slow");
  });
  it("AI ok: checked reading and its places resolved", async () => {
    const llm = async () => ({ places: [{ name: "Warangal", evidence: "warangal" }], start_place: { value: "Hyderabad", evidence: "hyderabad nundi" } });
    const a = await readWithAi("hyderabad nundi warangal", null, { ...deps, llm: llm as never, allowAi: async () => true });
    expect(a.status).toBe("ok");
    expect(a.start?.place?.name).toBe("Hyderabad");
    expect(a.places.map((p) => p.place?.name)).toEqual(["Warangal"]);
  });
});
