// Slice B: "is this map object the same place?" by name: spelling variants, Indian scripts, other names; and different places kept apart.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { foldWord, nameVariants, romanize, sameWord, samePlaceScore, aliasesFromTags } from "@/lib/place-intel/names";
import { MATCH_RULES, hoursNameScore, matchHours } from "@/lib/travel/hours-match";
import { matching, type PairFixture } from "@/lib/place-intel/metrics";
import { nameSimilarity } from "@/lib/season-match";

const pairs = (JSON.parse(readFileSync(new URL("./fixtures/place-intel/name-pairs.json", import.meta.url), "utf8")) as { pairs: PairFixture[] }).pairs;
const ALIAS_ONLY = new Set(pairs.filter((p) => /alias source/.test(p.why)).map((p) => p.id));

describe("the labelled name pairs (the Phase 0 fixture)", () => {
  const before = matching(pairs, nameSimilarity, MATCH_RULES);
  const after = matching(pairs, (a, b) => hoursNameScore(a, b), MATCH_RULES);
  it("measures before and after on the same pairs", () => {
    console.log(`[names] same place recognised: before ${before.sameRecall.pct}% (${before.sameRecall.num}/${before.sameRecall.den}), after ${after.sameRecall.pct}% (${after.sameRecall.num}/${after.sameRecall.den}); different places kept apart: before ${before.differentKeptApart.pct}%, after ${after.differentKeptApart.pct}%`);
    expect(after.sameRecall.num).toBeGreaterThan(before.sameRecall.num);
  });
  it("every pair that differs only in spelling, script, word order or extra words now matches", () => {
    for (const r of after.rows.filter((x) => x.shouldMatch && !ALIAS_ONLY.has(x.id))) expect(r.matchedNear, `${r.stop} / ${r.osm} (${r.why}) scored ${r.similarity}`).toBe(true);
  });
  it("never links a monument to a hotel, a station, a road, a restaurant, a beach or a dam named after it", () => {
    for (const r of after.rows.filter((x) => !x.shouldMatch)) expect(r.matchedNear, `${r.stop} / ${r.osm} scored ${r.similarity}`).toBe(false);
    expect(after.differentKeptApart.pct).toBe(100);
  });
  it("a different name for the same place needs the data's other names: without them it is NOT guessed", () => {
    for (const r of after.rows.filter((x) => ALIAS_ONLY.has(x.id))) expect(r.matchedNear, `${r.stop} / ${r.osm}`).toBe(false);
    // with the other name the map or Wikidata gives (made-up here: the test checks the mechanism, not a fact about any place)
    expect(samePlaceScore("Riverside Shrine", "Sri Ganga Devi Mandir", { aliasesB: ["Riverside Shrine"] })).toBe(1);
    expect(hoursNameScore("Old Ravipuram Palace", "Amba Nivas", ["Old Ravipuram Palace"])).toBe(1);
  });
});

describe("Indian scripts are read in Latin letters", () => {
  it("Telugu, Devanagari, Kannada, Bengali and Gujarati names romanize to the same folded name as their English spelling", () => {
    expect(samePlaceScore("Charminar", "చార్మినార్")).toBe(1);
    expect(samePlaceScore("Taj Mahal", "ताज महल")).toBe(1);
    expect(samePlaceScore("Ravipuram Kota", "रविपुरम कोटा")).toBeGreaterThanOrEqual(0.95);
    expect(samePlaceScore("Gol Gumbaz", "ಗೋಲ ಗುಂಬಜ")).toBeGreaterThanOrEqual(0.6);
    expect(samePlaceScore("Kalighat", "কালীঘাট")).toBe(1);
    expect(samePlaceScore("Ravipura Talav", "રવિપુરા તળાવ")).toBeGreaterThanOrEqual(0.6);
  });
  it("romanizes consonants with their vowels, and drops the vowel where the script says to", () => {
    expect(romanize("తిరుపతి")).toBe("tirupati");
    expect(romanize("मुंबई")).toBe("munbaii");
    expect(romanize("abc")).toBe("abc");
  });
  it("a different place in another script stays different", () => {
    expect(samePlaceScore("Charminar", "గోల్కొండ")).toBeLessThan(MATCH_RULES.minSimilarity);
  });
});

describe("spelling rules", () => {
  it("folds the usual Indian transliteration variants", () => {
    expect(foldWord("golconda")).toBe(foldWord("golkonda"));
    expect(foldWord("brihadeeswarar")).toBe("brihadisvarar");
    expect(sameWord(foldWord("mysore"), foldWord("mysuru"))).toBe(true);
    expect(sameWord(foldWord("amer"), foldWord("amber"))).toBe(true);
  });
  it("does not stretch short or unrelated words into each other", () => {
    expect(sameWord("ram", "rum")).toBe(false);
    expect(samePlaceScore("Ramappa Temple", "Rameshwaram Temple")).toBeLessThan(MATCH_RULES.minSimilarity);
    expect(samePlaceScore("Kondapalli Fort", "Kondaveedu Fort")).toBeLessThan(MATCH_RULES.minSimilarity);
    expect(samePlaceScore("Ravipuram Temple", "Ravipuram Lake")).toBe(0);
  });
  it("honorifics, word order and a name in brackets don't matter", () => {
    expect(samePlaceScore("Sri Lakshmi Narasimha Swamy Temple", "Lakshmi Narasimha Temple")).toBeGreaterThanOrEqual(0.95);
    expect(nameVariants("Sun Gate (Surya Dwar)")).toEqual(["Sun Gate (Surya Dwar)", "Sun Gate", "Surya Dwar"]);
    expect(samePlaceScore("Surya Dwar", "Sun Gate (Surya Dwar)")).toBe(1);
    expect(aliasesFromTags({ alt_name: "A;B", "name:te": "సి", phone: "123" })).toEqual(["A;B", "సి"]);
    expect(samePlaceScore("B", "Zed", { aliasesB: ["A;B"] })).toBe(0);                                       // one letter is not a name
    expect(samePlaceScore("Bheema Falls", "Zed Falls", { aliasesB: ["Abc;Bheema Falls"] })).toBe(1);
  });
});

describe("Trip Check matching: the same id wins before any name", () => {
  const stop = { name: "Hill Shrine", lat: 15, lng: 78 };
  it("an object with the stop's own id is the match, even under another name", () => {
    const m = matchHours({ ...stop, ids: { wikidata: "Q42" } }, [
      { ref: "osm/way/1", name: "Hill Shrine", lat: 15.0005, lng: 78, hours: "Mo-Su 06:00-12:00" },
      { ref: "osm/way/2", name: "Sri Malleswara Devasthanam", lat: 15.001, lng: 78, hours: "Mo-Su 05:00-21:00", ids: { wikidata: "Q42" } },
    ]);
    expect(m).toMatchObject({ kind: "match", by: "id", candidate: { ref: "osm/way/2" } });
  });
  it("the same id 50 km away is a data error, not a match", () => {
    expect(matchHours({ ...stop, ids: { osm: "way/9" } }, [{ ref: "osm/way/9", name: "Other", lat: 15.5, lng: 78, hours: "24/7", ids: { osm: "way/9" } }]).kind).toBe("none");
  });
  it("by name: a restaurant named after the shrine next door is never its hours", () => {
    const m = matchHours(stop, [{ ref: "osm/node/5", name: "Hill Shrine Restaurant", lat: 15.0001, lng: 78, hours: "Mo-Su 11:00-23:00" }]);
    expect(m.kind).toBe("none");
  });
  it("by name: a spelling variant in another script, close by, is a match", () => {
    expect(matchHours({ name: "Charminar", lat: 17.3616, lng: 78.4747 }, [{ ref: "osm/way/3", name: "చార్మినార్", lat: 17.3617, lng: 78.4747, hours: "Mo-Su 09:30-17:30" }])).toMatchObject({ kind: "match", by: "name" });
  });
});
