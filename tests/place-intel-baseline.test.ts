// Phase 0: a reproducible baseline for place understanding and opening hours. Run it with
//   npx vitest run tests/place-intel-baseline.test.ts                      (checks everything, writes nothing)
//   BASELINE_WRITE=1 npx vitest run tests/place-intel-baseline.test.ts      (also writes reports/place-intel/baseline.json and .md)
// Offline: the app's own reader runs against the India place index that ships with the repo; the OpenStreetMap search is stubbed as "not
// reachable". The live run (real network) is tests/place-intel-live.test.ts.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import type { ResolveDeps } from "@/lib/intake/places";
import { buildReport, isFailure, runPlaceBaseline } from "@/lib/place-intel/baseline";
import { matchesEntity, renderMarkdown, roleOfKind, scoreQuery, summarize, type QueryFixture, type PairFixture, type SystemAnswer, type SystemPlace, type TagsetFixture, type TruthEntry } from "@/lib/place-intel/metrics";

const fx = <T,>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/place-intel/${name}`, import.meta.url), "utf8")) as T;
const queries = fx<{ queries: QueryFixture[] }>("queries.json").queries;
const tagsets = fx<{ tagsets: TagsetFixture[] }>("tagsets.json").tagsets;
const pairs = fx<{ pairs: PairFixture[] }>("name-pairs.json").pairs;
const truth = fx<{ entries: TruthEntry[] }>("hours-truth.json").entries;

const offline: ResolveDeps = { index: () => loadGeoIndex(), photon: async () => [], allow: async () => true };
const LAYERS = {
  geonames: "The India place index that ships with the repo (about 70,000 places, GeoNames)",
  photon: "The OpenStreetMap search (Photon) was NOT reachable in this run (stubbed to return nothing)",
  overpass: "Overpass (OpenStreetMap tags) was not queried.",
};
const NOW = Date.UTC(2026, 9, 28);

describe("the labelled fixtures", () => {
  it("every query has a unique id, a group, a role, and an entity unless it is an ambiguous name", () => {
    expect(new Set(queries.map((q) => q.id)).size).toBe(queries.length);
    for (const q of queries) { expect(q.query.trim().length, q.id).toBeGreaterThan(1); if (q.expect.role !== "ambiguous") expect(q.expect.entity?.names.length, q.id).toBeGreaterThan(0); else expect(q.expect.ambiguous, q.id).toBe(true); }
  });
  it("covers every kind of query asked for: city, attraction, ambiguous, alternate spelling, category, hours, discovery", () => {
    const groups = new Set(queries.map((q) => q.group));
    for (const g of ["city", "region", "attraction", "compound", "ambiguous", "alt_spelling", "native_script", "category", "hours_question", "discovery"]) expect(groups.has(g as never), g).toBe(true);
  });
  it("spans at least 20 states and union territories", () => expect(new Set(queries.map((q) => q.expect.entity?.state).filter(Boolean)).size).toBeGreaterThanOrEqual(20));
  it("is not built around the example cities: no single place is more than a tenth of the queries", () => {
    const hits = new Map<string, number>();
    for (const q of queries) for (const n of new Set((q.expect.entity?.names ?? []).slice(0, 1))) hits.set(n, (hits.get(n) ?? 0) + 1);
    for (const [name, n] of hits) expect(n / queries.length, name).toBeLessThanOrEqual(0.1);
    for (const ex of ["Tirupati", "Visakhapatnam", "Hyderabad", "Goa"]) expect((hits.get(ex) ?? 0) / queries.length, ex).toBeLessThanOrEqual(0.05);
  });
  it("the trusted-hours file is empty, because hours are never written from memory", () => expect(truth).toEqual([]));
  it("every tag shape and name pair is labelled, and the two kinds of name pair are both present", () => {
    expect(tagsets.length).toBeGreaterThanOrEqual(30);
    expect(pairs.some((p) => p.shouldMatch)).toBe(true); expect(pairs.some((p) => !p.shouldMatch)).toBe(true);
  });
});

describe("the scoring rules", () => {
  const place = (over: Partial<SystemPlace> = {}): SystemPlace => ({ said: "x", status: "sure", name: "Tirupati", kind: "city", state: "Andhra Pradesh", alternatives: 0, ...over });
  const ans = (places: SystemPlace[], over: Partial<SystemAnswer> = {}): SystemAnswer => ({ places, interests: [], intent: null, suggestions: 0, ms: 1, ...over });
  const city: QueryFixture = { id: "x1", group: "city", query: "Tirupati", expect: { role: "city_region", entity: { names: ["Tirupati"], state: "Andhra Pradesh" } } };
  const attraction: QueryFixture = { id: "x2", group: "attraction", query: "Charminar", expect: { role: "attraction", entity: { names: ["Charminar"], state: "Telangana" } } };

  it("kinds map to the role a traveller cares about", () => {
    for (const k of ["city", "town", "state", "district", "locality", "subdistrict", "village"]) expect(roleOfKind(k)).toBe("city_region");
    for (const k of ["sight", "water", "hill", "coast", "park"]) expect(roleOfKind(k)).toBe("attraction");
    expect(roleOfKind("airport")).toBe("other"); expect(roleOfKind(null)).toBe("other");
  });
  it("a name matches on any accepted spelling, ignores accents and case, and checks the state when it has one", () => {
    const e = { names: ["Mysuru", "Mysore"], state: "Karnataka" };
    expect(matchesEntity(place({ name: "Mysore", state: "Karnataka" }), e).ok).toBe(true);
    expect(matchesEntity(place({ name: "MYSURU", state: "Karnataka" }), e).ok).toBe(true);
    expect(matchesEntity(place({ name: "Mysore", state: "Tamil Nadu" }), e).ok).toBe(false);
    expect(matchesEntity(place({ name: "Mysore", state: null }), e)).toEqual({ ok: true, stateChecked: false });
    expect(matchesEntity(place({ name: "Mandya", state: "Karnataka" }), e).ok).toBe(false);
    expect(matchesEntity(place({ status: "missing", name: null }), e).ok).toBe(false);
  });
  it("old and new state names are the same state", () => {
    const e = { names: ["Puri"], state: "Odisha" };
    expect(matchesEntity(place({ name: "Puri", state: "Orissa" }), e).ok).toBe(true);
    expect(matchesEntity(place({ name: "Delhi", state: "NCT of Delhi" }), { names: ["Delhi"], state: "Delhi" }).ok).toBe(true);
  });
  it("a city found as a city is right; an attraction found only as a town is found but the WRONG kind", () => {
    expect(scoreQuery(city, ans([place()]))).toMatchObject({ found: true, roleOk: true });
    const r = scoreQuery(attraction, ans([place({ name: "Charminar", kind: "town", state: "Telangana" })]));
    expect(r).toMatchObject({ found: true, roleOk: false });
    expect(isFailure(r)).toBe(true);
  });
  it("the right name in the wrong state is its own failure, counted apart from not found (it looks right, which is worse)", () => {
    const r = scoreQuery(attraction, ans([place({ said: "Charminar", name: "Charminar", kind: "sight", state: "Tamil Nadu" })]));
    expect(r).toMatchObject({ found: false, wrongState: true }); expect(isFailure(r)).toBe(true);
    expect(scoreQuery(attraction, ans([place({ name: "Charminar", kind: "sight", state: "Telangana" })])).wrongState).toBe(false);
    expect(scoreQuery(attraction, ans([place({ name: "Hyderabad", state: "Telangana" })])).wrongState).toBe(false);   // a different name is simply not found
    expect(summarize([r]).wrongState).toEqual({ num: 1, den: 1, pct: 100 });
  });
  it("an attraction not found at all is a failure, and says what came back instead", () => {
    const r = scoreQuery(attraction, ans([place({ said: "Hyderabad", name: "Hyderabad", kind: "city", state: "Telangana" })]));
    expect(r.found).toBe(false); expect(r.gotInstead).toContain("Hyderabad"); expect(isFailure(r)).toBe(true);
    expect(scoreQuery(attraction, ans([])).gotInstead).toBe("nothing recognised");
  });
  const amb: QueryFixture = { id: "x3", group: "ambiguous", query: "Aurangabad", expect: { role: "ambiguous", ambiguous: true } };
  it("an ambiguous name: asking with candidates is right, silently picking one is a silent guess", () => {
    expect(scoreQuery(amb, ans([place({ status: "check", alternatives: 3 })])).ambiguity).toBe("handled");
    expect(scoreQuery(amb, ans([place({ status: "sure" })])).ambiguity).toBe("silent_guess");
    expect(scoreQuery(amb, ans([place({ status: "check", alternatives: 0 })])).ambiguity).not.toBe("handled");   // "check" with nothing to choose between is not a clarification
    expect(scoreQuery(amb, ans([])).ambiguity).toBe("not_found");
    expect(isFailure(scoreQuery(amb, ans([place({ status: "sure" })])))).toBe(true);
    expect(isFailure(scoreQuery(amb, ans([place({ status: "check", alternatives: 2 })])))).toBe(false);
  });
  it("asking 'check this' about a clear query is a false clarification", () => {
    const r = scoreQuery(city, ans([place({ status: "check", alternatives: 1 })]));
    expect(r.ambiguity).toBe("false_alarm"); expect(isFailure(r)).toBe(true);
  });
  it("a category request needs the place AND the kind of place understood, and attractions suggested", () => {
    const c: QueryFixture = { id: "x4", group: "category", query: "beaches near Visakhapatnam", expect: { role: "category", entity: { names: ["Visakhapatnam"], state: "Andhra Pradesh" }, interest: ["beaches"] } };
    const good = scoreQuery(c, ans([place({ name: "Visakhapatnam" })], { interests: ["beaches"], suggestions: 4 }));
    expect(good).toMatchObject({ found: true, roleOk: true, interestOk: true, suggestionsOffered: true });
    const today = scoreQuery(c, ans([place({ name: "Visakhapatnam" })], { interests: ["beaches"] }));
    expect(today.interestOk).toBe(true); expect(today.suggestionsOffered).toBe(false); expect(isFailure(today)).toBe(true);
  });
  it("an hours question needs the QUESTION understood: today's reader has no such field, and that is measured, not assumed", () => {
    const h: QueryFixture = { id: "x5", group: "hours_question", query: "is Charminar open now", expect: { role: "hours", entity: { names: ["Charminar"], state: "Telangana" }, intent: "hours" } };
    const found = place({ name: "Charminar", kind: "sight", state: "Telangana" });
    expect(scoreQuery(h, ans([found])).intentOk).toBe(false);
    expect(scoreQuery(h, ans([found], { intent: "hours" })).intentOk).toBe(true);
  });
  it("summaries count with their denominators, and a rate with nothing to count is n/a, never 0%", () => {
    const rs = [scoreQuery(city, ans([place()])), scoreQuery(attraction, ans([])), scoreQuery(amb, ans([place({ status: "sure" })]))];
    const s = summarize(rs);
    expect(s.entityFound).toEqual({ num: 1, den: 2, pct: 50 });
    expect(s.silentGuesses).toEqual({ num: 1, den: 1, pct: 100 });
    expect(s.intentCaptured).toEqual({ num: 0, den: 0, pct: null });
  });
});

describe("the baseline run (the real code, offline)", () => {
  let results: Awaited<ReturnType<typeof runPlaceBaseline>>;
  it("runs every labelled query through the app's own reader", async () => {
    results = await runPlaceBaseline(queries, offline, NOW);
    expect(results).toHaveLength(queries.length);
    expect(results.every((r) => r.gotInstead.length > 0)).toBe(true);
  }, 120_000);

  it("is reproducible: a second run gives exactly the same answers (speed aside)", async () => {
    const again = await runPlaceBaseline(queries, offline, NOW);
    const strip = (rs: typeof results) => rs.map(({ ms, ...rest }) => { void ms; return rest; });
    expect(strip(again)).toEqual(strip(results));
  }, 120_000);

  it("builds the report, says what was and was not measured, and states hours correctness is not measurable", () => {
    const report = buildReport({ queries, results, tagsets, pairs, truth, layers: LAYERS });
    const md = renderMarkdown(report);
    expect(report.fixtures).toMatchObject({ queries: queries.length, tagsets: tagsets.length, namePairs: pairs.length, hoursTruthEntries: 0 });
    expect(report.hours.truth).toEqual({ entries: 0, measurable: false });
    for (const s of ["What was measured, and what was not", "NOT measured here", "LOWER BOUND", "Not measurable yet", "Every query that did not do the right thing"]) expect(md).toContain(s);
    // the headline counts add up
    const s = report.place.summary;
    expect(s.entityFound.den).toBe(queries.filter((q) => q.expect.role !== "ambiguous").length);
    expect(s.ambiguityHandled.den).toBe(queries.filter((q) => q.expect.role === "ambiguous").length);
    expect(report.place.failures.length).toBeLessThanOrEqual(queries.length);
    if (process.env.BASELINE_WRITE === "1") {
      mkdirSync(new URL("../reports/place-intel/", import.meta.url), { recursive: true });
      const { latency, ...stable } = report; void latency;
      writeFileSync(new URL("../reports/place-intel/baseline.json", import.meta.url), JSON.stringify({ ...stable, latencyNote: "speed varies by machine: see baseline.md" }, null, 1) + "\n");
      writeFileSync(new URL("../reports/place-intel/baseline.md", import.meta.url), md + "\n");
    }
  });
});
