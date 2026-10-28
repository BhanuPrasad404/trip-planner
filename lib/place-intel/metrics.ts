// Phase 0 of "India-wide place understanding and opening hours": MEASURE what the app does today, the same way every time.
// Everything here is pure (no network, no clock, no files) so each rule is testable, and nothing names a particular city: the labelled
// queries live in tests/fixtures/place-intel/. What is MEASURED (run on the real code) and what is NOT is stated in the report itself.
import { normalizeName } from "@/lib/places/types";

export type Role = "city_region" | "attraction" | "ambiguous" | "category" | "discovery" | "hours";
export type Group = "city" | "region" | "attraction" | "compound" | "ambiguous" | "alt_spelling" | "native_script" | "category" | "hours_question" | "discovery";
export type QueryFixture = {
  id: string; group: Group; query: string; note?: string;
  expect: { role: Role; entity?: { names: string[]; state?: string }; interest?: string[]; ambiguous?: boolean; intent?: "hours" | "discovery" };
};
export type SystemPlace = { said: string; status: "sure" | "check" | "missing"; name: string | null; kind: string | null; state: string | null; alternatives: number };
/** What the app's current "read what the traveller wrote" path returned, reduced to what the scoring needs. */
export type SystemAnswer = { places: SystemPlace[]; interests: string[]; intent: string | null; suggestions: number; ms: number };

const SETTLEMENT = new Set(["city", "town", "locality", "village", "subdistrict", "district", "state"]);
const SIGHT = new Set(["sight", "water", "hill", "coast", "park"]);
/** What a resolved kind means for the traveller: a place to stay in / pass through, or a thing to visit. */
export const roleOfKind = (kind: string | null): "city_region" | "attraction" | "other" => (!kind ? "other" : SETTLEMENT.has(kind) ? "city_region" : SIGHT.has(kind) ? "attraction" : "other");

const STATE_ALIASES: Record<string, string> = { orissa: "odisha", uttaranchal: "uttarakhand", "nct of delhi": "delhi", "national capital territory of delhi": "delhi", "new delhi": "delhi", pondicherry: "puducherry", "state of": "" };
const stateKey = (s: string) => { const n = normalizeName(s).replace(/^state of /, ""); return STATE_ALIASES[n] ?? n; };
const nameKey = (s: string) => normalizeName(s).replace(/\b(the|sri|shri|temple|fort|palace|mandir)\b/g, "").replace(/\s+/g, "");

/** Does a resolved place match what was labelled? Any accepted name (equal, or one contains the other when long enough) and the state. */
export function matchesEntity(place: SystemPlace, entity: { names: string[]; state?: string }): { ok: boolean; stateChecked: boolean } {
  if (!place.name || place.status === "missing") return { ok: false, stateChecked: false };
  const got = nameKey(place.name), full = normalizeName(place.name).replace(/\s+/g, "");
  const nameOk = entity.names.some((n) => {
    const want = nameKey(n), wantFull = normalizeName(n).replace(/\s+/g, "");
    return got === want || full === wantFull || (want.length >= 4 && (got.includes(want) || want.includes(got) && got.length >= 4)) || (wantFull.length >= 5 && full.includes(wantFull));
  });
  if (!nameOk) return { ok: false, stateChecked: false };
  if (!entity.state) return { ok: true, stateChecked: false };
  if (!place.state) return { ok: true, stateChecked: false };                  // the place carries no state: the name alone is all we can check
  return { ok: stateKey(place.state) === stateKey(entity.state), stateChecked: true };
}

export type Ambiguity = "handled" | "silent_guess" | "not_found" | "false_alarm" | "n/a";
export type QueryResult = {
  id: string; group: Group; query: string; expectedRole: Role;
  found: boolean; matched: { name: string; kind: string | null; state: string | null; stateChecked: boolean } | null;
  /** The right NAME came back but in the wrong state (a different place with the same name). Worse than not found: it looks right. */
  wrongState: boolean;
  /** Did the resolved place have the right KIND of role (a city for a city, a thing to visit for an attraction)? null when nothing was found. */
  roleOk: boolean | null;
  ambiguity: Ambiguity;
  interestOk: boolean | null; intentOk: boolean | null; suggestionsOffered: boolean | null;
  /** What came back when the labelled place was not found (so a failure can be read, not just counted). */
  gotInstead: string;
  ms: number;
};

const ANCHOR_ROLE: Record<Role, "city_region" | "attraction" | null> = { city_region: "city_region", attraction: "attraction", ambiguous: null, category: "city_region", discovery: "city_region", hours: "attraction" };

export function scoreQuery(q: QueryFixture, a: SystemAnswer): QueryResult {
  const e = q.expect;
  const descr = a.places.length ? a.places.map((p) => `${p.said}→${p.status === "missing" ? "not found" : `${p.name} (${p.kind}${p.state ? `, ${p.state}` : ""})${p.status === "check" ? " [asked to check]" : ""}`}`).join("; ") : "nothing recognised";
  const base = { id: q.id, group: q.group, query: q.query, expectedRole: e.role, gotInstead: descr, ms: a.ms };
  const wantsIntent = e.intent !== undefined, wantsInterest = !!e.interest?.length;
  const intentOk = wantsIntent ? a.intent === e.intent : null;
  const interestOk = wantsInterest ? e.interest!.some((i) => a.interests.includes(i)) : null;
  const suggestionsOffered = e.role === "discovery" || e.role === "category" ? a.suggestions > 0 : null;

  if (e.ambiguous) {
    const flagged = a.places.some((p) => p.status === "check" && p.alternatives >= 1);
    const guessed = a.places.some((p) => p.status === "sure");
    return { ...base, found: false, matched: null, wrongState: false, roleOk: null, ambiguity: flagged ? "handled" : guessed ? "silent_guess" : "not_found", interestOk, intentOk, suggestionsOffered };
  }
  let matched: QueryResult["matched"] = null;
  for (const p of a.places) { const m = e.entity ? matchesEntity(p, e.entity) : { ok: false, stateChecked: false }; if (m.ok) { matched = { name: p.name!, kind: p.kind, state: p.state, stateChecked: m.stateChecked }; break; } }
  const wrongState = !matched && !!e.entity?.state && a.places.some((p) => matchesEntity(p, { names: e.entity!.names }).ok);
  const want = ANCHOR_ROLE[e.role];
  const roleOk = matched && want ? roleOfKind(matched.kind) === want : null;
  const top = a.places[0];
  return { ...base, found: !!matched, matched, wrongState, roleOk, ambiguity: top?.status === "check" ? "false_alarm" : "n/a", interestOk, intentOk, suggestionsOffered };
}

const rate = (num: number, den: number) => ({ num, den, pct: den === 0 ? null : Math.round((num / den) * 1000) / 10 });
export type Rate = ReturnType<typeof rate>;
const quantile = (xs: number[], q: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] * 100) / 100; };

export type PlaceSummary = {
  queries: number;
  entityFound: Rate;               // the labelled place came back (all queries that name one)
  wrongState: Rate;                // the right name came back, but a place with that name in the WRONG state
  roleCorrect: Rate;               // …and it was the right kind of thing (city vs attraction), out of those found
  roleCorrectOfAll: Rate;          // …out of ALL queries that name one (a place that wasn't found counts as wrong)
  ambiguityHandled: Rate;          // ambiguous queries where the app asked instead of guessing
  silentGuesses: Rate;             // ambiguous queries where the app picked one without asking
  falseClarifications: Rate;       // clear queries where the app asked "check this" anyway
  interestCaptured: Rate;          // category queries where the kind of place wanted was understood (coarse interests only)
  intentCaptured: Rate;            // hours and discovery questions where the QUESTION itself was understood
  suggestionsOffered: Rate;        // discovery and category questions where attractions were suggested
};
export function summarize(rs: QueryResult[]): PlaceSummary {
  const needEntity = rs.filter((r) => r.expectedRole !== "ambiguous");
  const found = needEntity.filter((r) => r.found);
  const amb = rs.filter((r) => r.expectedRole === "ambiguous");
  const count = (xs: QueryResult[], f: (r: QueryResult) => boolean | null | undefined) => xs.filter((r) => f(r) === true).length;
  const withInterest = rs.filter((r) => r.interestOk !== null), withIntent = rs.filter((r) => r.intentOk !== null), withSug = rs.filter((r) => r.suggestionsOffered !== null);
  return {
    queries: rs.length,
    entityFound: rate(found.length, needEntity.length),
    wrongState: rate(needEntity.filter((r) => r.wrongState).length, needEntity.length),
    roleCorrect: rate(count(found, (r) => r.roleOk), found.filter((r) => r.roleOk !== null).length),
    roleCorrectOfAll: rate(count(needEntity, (r) => r.roleOk), needEntity.filter((r) => ANCHOR_ROLE[r.expectedRole] !== null).length),
    ambiguityHandled: rate(amb.filter((r) => r.ambiguity === "handled").length, amb.length),
    silentGuesses: rate(amb.filter((r) => r.ambiguity === "silent_guess").length, amb.length),
    falseClarifications: rate(needEntity.filter((r) => r.ambiguity === "false_alarm").length, needEntity.length),
    interestCaptured: rate(count(withInterest, (r) => r.interestOk), withInterest.length),
    intentCaptured: rate(count(withIntent, (r) => r.intentOk), withIntent.length),
    suggestionsOffered: rate(count(withSug, (r) => r.suggestionsOffered), withSug.length),
  };
}

export const byGroup = (rs: QueryResult[]): Record<string, PlaceSummary> => Object.fromEntries([...new Set(rs.map((r) => r.group))].sort().map((g) => [g, summarize(rs.filter((r) => r.group === g))]));
export function byState(rs: QueryResult[], q: QueryFixture[]): { state: string; queries: number; found: number }[] {
  const st = new Map(q.map((x) => [x.id, x.expect.entity?.state]));
  const m = new Map<string, { queries: number; found: number }>();
  for (const r of rs) { const s = st.get(r.id); if (!s) continue; const v = m.get(s) ?? { queries: 0, found: 0 }; v.queries++; if (r.found) v.found++; m.set(s, v); }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([state, v]) => ({ state, ...v }));
}
export const latency = (rs: QueryResult[]) => ({ p50Ms: quantile(rs.map((r) => r.ms), 0.5), p95Ms: quantile(rs.map((r) => r.ms), 0.95), maxMs: quantile(rs.map((r) => r.ms), 1) });

// ── Opening hours: what can be measured WITHOUT the network ─────────────────────────────────────────────────────────────────────────
export const HOURS_LIKE = ["opening_hours", "service_times", "opening_hours:url", "contact:website", "website", "check_date"] as const;
export type TagsetFixture = { id: string; label: string; category: string; tags: Record<string, string> };
export type Admission = { id: string; label: string; category: string; admitted: boolean; kind: string | null; hoursLikePresent: string[]; hoursLikeKept: string[] };
export function admission(tagsets: TagsetFixture[], toRecord: (tags: Record<string, string>) => { kind: string; tags: Record<string, string> } | null): Admission[] {
  return tagsets.map((t) => {
    const rec = toRecord(t.tags);
    const present = HOURS_LIKE.filter((k) => !!t.tags[k]);
    return { id: t.id, label: t.label, category: t.category, admitted: !!rec, kind: rec?.kind ?? null, hoursLikePresent: [...present], hoursLikeKept: rec ? present.filter((k) => !!rec.tags[k]) : [] };
  });
}
export function summarizeAdmission(rows: Admission[], fixtures: TagsetFixture[]) {
  const named = rows.filter((r) => !!fixtures.find((f) => f.id === r.id)?.tags.name);
  const cats = [...new Set(named.map((r) => r.category))].sort();
  const present = rows.flatMap((r) => r.hoursLikePresent.map((k) => ({ k, kept: r.hoursLikeKept.includes(k) })));
  const tagNames = [...new Set(present.map((p) => p.k))].sort();
  return {
    shapes: named.length,
    admitted: rate(named.filter((r) => r.admitted).length, named.length),
    byCategory: cats.map((c) => ({ category: c, ...rate(named.filter((r) => r.category === c && r.admitted).length, named.filter((r) => r.category === c).length) })),
    hoursTagsKept: tagNames.map((k) => ({ tag: k, ...rate(present.filter((p) => p.k === k && p.kept).length, present.filter((p) => p.k === k).length) })),
  };
}

export type PairFixture = { id: string; stop: string; osm: string; shouldMatch: boolean; why: string };
export type PairResult = { id: string; stop: string; osm: string; why: string; similarity: number; shouldMatch: boolean; matchedNear: boolean; matchedFar: boolean };
export function matching(pairs: PairFixture[], sim: (a: string, b: string) => number, rules: { minSimilarity: number; farSimilarity: number }): { rows: PairResult[]; sameRecall: Rate; differentKeptApart: Rate } {
  const rows = pairs.map((p) => { const s = sim(p.stop, p.osm); return { id: p.id, stop: p.stop, osm: p.osm, why: p.why, similarity: Math.round(s * 100) / 100, shouldMatch: p.shouldMatch, matchedNear: s >= rules.minSimilarity, matchedFar: s >= rules.farSimilarity }; });
  const same = rows.filter((r) => r.shouldMatch), diff = rows.filter((r) => !r.shouldMatch);
  return { rows, sameRecall: rate(same.filter((r) => r.matchedNear).length, same.length), differentKeptApart: rate(diff.filter((r) => !r.matchedNear).length, diff.length) };
}

export type TruthEntry = { placeName: string; state: string; officialUrl: string; readOn: string; schedule: string; notes?: string; reader?: string };
/** Hours correctness can only be measured against hand-copied trusted entries; with none, it is reported as NOT measurable, never as a number. */
export const truthStatus = (entries: TruthEntry[]) => ({ entries: entries.length, measurable: entries.length > 0 });

export type Report = {
  schema: 1;
  layers: { geonames: string; photon: string; overpass: string };
  fixtures: { queries: number; states: number; tagsets: number; namePairs: number; hoursTruthEntries: number };
  place: { summary: PlaceSummary; byGroup: Record<string, PlaceSummary>; byState: ReturnType<typeof byState>; failures: QueryResult[] };
  hours: { admission: ReturnType<typeof summarizeAdmission>; admissionRows: Admission[]; matching: ReturnType<typeof matching>; truth: ReturnType<typeof truthStatus> };
  latency: ReturnType<typeof latency>;
};

const pct = (r: Rate) => (r.pct === null ? "n/a" : `${r.pct}% (${r.num}/${r.den})`);
export function renderMarkdown(rep: Report): string {
  const s = rep.place.summary, L: string[] = [];
  L.push("# Place understanding and opening hours: Phase 0 baseline", "");
  L.push("## What was measured, and what was not", "");
  L.push(`- **Measured on the real code, offline:** TrailMate's own "read what the traveller wrote" path (\`readInstant\`), run on ${rep.fixtures.queries} labelled queries across ${rep.fixtures.states} states.`);
  L.push(`- **Place data used:** ${rep.layers.geonames}. ${rep.layers.photon}. So results for attractions are a LOWER BOUND for the full app, which can also ask the OpenStreetMap search.`);
  L.push(`- **Opening hours, measured offline:** what the current code does with ${rep.fixtures.tagsets} hand-written OpenStreetMap shapes, and how its name matching treats ${rep.fixtures.namePairs} hand-labelled name pairs. These are SHAPES and PAIRS, not real coverage.`);
  L.push(`- **NOT measured here:** real OpenStreetMap hours coverage for Indian places, correctness of any hours (${rep.fixtures.hoursTruthEntries} trusted entries exist), cache hit rate, and real-network latency. ${rep.layers.overpass}`, "");
  L.push("## Place understanding (current system)", "", "| Measure | Result |", "|---|---|");
  L.push(`| Labelled place found | ${pct(s.entityFound)} |`, `| Right name, WRONG state (a different place with the same name) | ${pct(s.wrongState)} |`, `| Right kind of place (city vs attraction), of those found | ${pct(s.roleCorrect)} |`, `| Right kind of place, of all | ${pct(s.roleCorrectOfAll)} |`);
  L.push(`| Ambiguous name: asked instead of guessing | ${pct(s.ambiguityHandled)} |`, `| Ambiguous name: silently picked one | ${pct(s.silentGuesses)} |`, `| Clear query: asked "check this" anyway | ${pct(s.falseClarifications)} |`);
  L.push(`| Category request: kind of place understood (coarse interests only) | ${pct(s.interestCaptured)} |`, `| Hours or discovery question: the QUESTION understood | ${pct(s.intentCaptured)} |`, `| Discovery or category request: attractions suggested | ${pct(s.suggestionsOffered)} |`, "");
  L.push("### By kind of query", "", "| Group | Queries | Found | Right kind | Asked when ambiguous | Silent guess | Asked needlessly |", "|---|---|---|---|---|---|---|");
  for (const [g, v] of Object.entries(rep.place.byGroup)) L.push(`| ${g} | ${v.queries} | ${pct(v.entityFound)} | ${pct(v.roleCorrect)} | ${pct(v.ambiguityHandled)} | ${pct(v.silentGuesses)} | ${pct(v.falseClarifications)} |`);
  L.push("", "### By state (labelled place found)", "", "| State | Found |", "|---|---|");
  for (const st of rep.place.byState) L.push(`| ${st.state} | ${st.found}/${st.queries} |`);
  L.push("", `### Every query that did not do the right thing (${rep.place.failures.length})`, "", "| id | group | query | what came back |", "|---|---|---|---|");
  for (const f of rep.place.failures) L.push(`| ${f.id} | ${f.group} | ${f.query} | ${f.gotInstead.replace(/\|/g, "/")}${f.found && f.roleOk === false ? " (found, but as the wrong kind of place)" : ""}${f.wrongState ? " (right name, WRONG state)" : ""}${f.ambiguity === "silent_guess" ? " (should have asked)" : ""} |`);
  L.push("", "## Opening hours (current system, offline)", "", `### Which OpenStreetMap shapes become a place we can look hours up for`, "", `Kept as a place: ${pct(rep.hours.admission.admitted)} of ${rep.hours.admission.shapes} named shapes.`, "", "| Kind of place | Kept |", "|---|---|");
  for (const c of rep.hours.admission.byCategory) L.push(`| ${c.category} | ${pct(c)} |`);
  L.push("", "Hours-related tags that survive when a shape is stored:", "", "| Tag | Kept |", "|---|---|");
  for (const t of rep.hours.admission.hoursTagsKept) L.push(`| \`${t.tag}\` | ${pct(t)} |`);
  L.push("", "### Name matching between a trip stop and a map object", "", `Same place recognised: ${pct(rep.hours.matching.sameRecall)}. Different places kept apart: ${pct(rep.hours.matching.differentKeptApart)}.`, "", "| Stop | Map name | Similarity | Should match | Matches now |", "|---|---|---|---|---|");
  for (const r of rep.hours.matching.rows) L.push(`| ${r.stop} | ${r.osm} | ${r.similarity} | ${r.shouldMatch ? "yes" : "no"} | ${r.matchedNear ? "yes" : "no"} |`);
  L.push("", "### Correctness of hours", "", rep.hours.truth.measurable ? `${rep.hours.truth.entries} trusted entries.` : "**Not measurable yet:** `tests/fixtures/place-intel/hours-truth.json` has no trusted entries. Nothing is guessed to fill it.", "", "## Speed (this machine, offline; varies from run to run)", "", `p50 ${rep.latency.p50Ms} ms, p95 ${rep.latency.p95Ms} ms, max ${rep.latency.maxMs} ms per query.`, "");
  return L.join("\n");
}
