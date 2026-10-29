// Runs TrailMate's CURRENT behaviour over the labelled fixtures and builds the Phase 0 report. It calls the same functions the app calls
// (readInstant for "what did the traveller write", toRecord for "does this map object become a place", nameSimilarity + MATCH_RULES for
// "is this map object that trip stop"), so the baseline cannot drift from the product. Outside services are injected: offline runs pass
// stubs, the live run passes the real ones.
import type { ResolveDeps } from "@/lib/intake/places";
import { readInstant } from "@/lib/intake/service";
import { toRecord } from "@/lib/poi/taxonomy";
import { MATCH_RULES, hoursNameScore } from "@/lib/travel/hours-match";
import { admission, byGroup, byState, latency, matching, scoreQuery, summarizeAdmission, summarize, truthStatus, type PairFixture, type QueryFixture, type QueryResult, type Report, type SystemAnswer, type TagsetFixture, type TruthEntry } from "./metrics";

/** One query through the app's own reader, reduced to what scoring needs. */
export async function currentAnswer(text: string, deps: ResolveDeps, now: number): Promise<SystemAnswer> {
  const t0 = performance.now();
  const r = await readInstant(text, null, deps, now);
  return answerFromInstant(r, performance.now() - t0);
}

export function answerFromInstant(r: Awaited<ReturnType<typeof readInstant>>, ms: number): SystemAnswer {
  // Capabilities are looked for by SHAPE, not assumed: if a later phase adds an `intent` or `suggestions` field, the same harness sees it.
  const extra = r as unknown as { intent?: { kind?: string } | string; suggestions?: unknown[] };
  const u = r.understanding as unknown as { intent?: { kind?: string } | string };
  const raw = extra.intent ?? u.intent ?? null;
  return {
    places: r.places.map((p) => ({ said: p.said, status: p.status, name: p.place?.name ?? null, kind: p.place?.kind ?? null, state: p.place?.state ?? null, alternatives: p.alternatives.length })),
    interests: (r.understanding.answers.interests?.value as string[] | undefined) ?? [],
    intent: raw === null ? null : typeof raw === "string" ? raw : raw.kind ?? null,
    suggestions: Array.isArray(extra.suggestions) ? extra.suggestions.length : 0,
    ms,
  };
}

export async function runPlaceBaseline(queries: QueryFixture[], deps: ResolveDeps, now: number): Promise<QueryResult[]> {
  const out: QueryResult[] = [];
  for (const q of queries) out.push(scoreQuery(q, await currentAnswer(q.query, deps, now)));   // one at a time: reproducible, and kind to a real network
  return out;
}

/** Is a result a failure worth listing? Anything not found, found as the wrong kind, guessed silently, or a question not understood. */
export const isFailure = (r: QueryResult) => (r.expectedRole === "ambiguous" ? r.ambiguity !== "handled" : !r.found || r.roleOk === false || r.intentOk === false || r.interestOk === false || r.suggestionsOffered === false || r.ambiguity === "false_alarm" || r.wrongState);

export function buildReport(input: { queries: QueryFixture[]; results: QueryResult[]; tagsets: TagsetFixture[]; pairs: PairFixture[]; truth: TruthEntry[]; layers: Report["layers"] }): Report {
  const adm = admission(input.tagsets, (tags) => { const r = toRecord({ id: "fixture", lat: 17, lng: 78, tags }, "osm", "2026-01-01T00:00:00Z"); return r ? { kind: r.kind, tags: r.tags } : null; });
  return {
    schema: 1,
    layers: input.layers,
    fixtures: { queries: input.queries.length, states: new Set(input.queries.map((q) => q.expect.entity?.state).filter(Boolean)).size, tagsets: input.tagsets.length, namePairs: input.pairs.length, hoursTruthEntries: input.truth.length },
    place: { summary: summarize(input.results), byGroup: byGroup(input.results), byState: byState(input.results, input.queries), failures: input.results.filter(isFailure) },
    hours: { admission: summarizeAdmission(adm, input.tagsets), admissionRows: adm, matching: matching(input.pairs, (a, b) => hoursNameScore(a, b), MATCH_RULES), truth: truthStatus(input.truth) },
    latency: latency(input.results),
  };
}
