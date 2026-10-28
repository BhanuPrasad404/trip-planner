// Phase 0, LIVE: the same labelled queries through the app's real place search (our India index AND the OpenStreetMap search), then, for
// every attraction that came back as a map object, ONE question to Overpass: which hours-related tags does that object really carry?
// That is the only way to measure real coverage. It talks to free public services, so it is OFF unless asked for, goes one request at a time
// with a pause, and never runs in CI:
//   PLACE_INTEL_LIVE=1 GEOCODER_USER_AGENT="Trailmate/1.0 (you@example.com)" npx vitest run tests/place-intel-live.test.ts
// Optional: PLACE_INTEL_LIMIT=20 (first N queries only), PLACE_INTEL_PAUSE_MS=1500.
// It writes reports/place-intel/live-baseline.json and .md. It measures PRESENCE of hours tags, not their correctness.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OVERPASS_MIRRORS } from "@/lib/nearby";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { photonSearch } from "@/lib/places/photon";
import { readInstant } from "@/lib/intake/service";
import { answerFromInstant, isFailure } from "@/lib/place-intel/baseline";
import { byGroup, matchesEntity, scoreQuery, summarize, type QueryFixture, type QueryResult } from "@/lib/place-intel/metrics";

const LIVE = process.env.PLACE_INTEL_LIVE === "1" && !process.env.CI;
const queries = (JSON.parse(readFileSync(new URL("./fixtures/place-intel/queries.json", import.meta.url), "utf8")) as { queries: QueryFixture[] }).queries;
const limit = Number(process.env.PLACE_INTEL_LIMIT) || queries.length;
const pause = Math.max(800, Number(process.env.PLACE_INTEL_PAUSE_MS) || 1200);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const UA = process.env.GEOCODER_USER_AGENT || "Trailmate/0.1 (place-intel baseline)";

type Probe = { query: string; osmId: string; outcome: "tags" | "not_a_map_object" | "unavailable"; tags: { openingHours: boolean; serviceTimes: boolean; hoursUrl: boolean; website: boolean; wikidata: boolean; wikipedia: boolean; checkDate: boolean }; openingHoursText: string | null };

async function probe(id: string): Promise<{ tags: Record<string, string> } | "unavailable"> {
  const m = /^osm:([NWR])(\d+)$/.exec(id);
  if (!m) return "unavailable";
  const type = { N: "node", W: "way", R: "relation" }[m[1] as "N" | "W" | "R"];
  const body = `data=${encodeURIComponent(`[out:json][timeout:20];${type}(${m[2]});out tags;`)}`;
  for (const url of [process.env.OVERPASS_URL, ...OVERPASS_MIRRORS].filter((u): u is string => !!u)) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, body, signal: AbortSignal.timeout(25_000) });
      if (!res.ok) continue;
      const json = (await res.json()) as { elements?: { tags?: Record<string, string> }[]; remark?: string };
      if (json.remark && /timed out|too many|rate_limited/i.test(json.remark)) continue;
      return { tags: json.elements?.[0]?.tags ?? {} };
    } catch { /* try the next server */ }
  }
  return "unavailable";
}

describe.skipIf(!LIVE)("LIVE baseline (network, slow, polite)", () => {
  it("scores the real place search and probes the hours tags of every attraction it found", async () => {
    const deps = { index: () => loadGeoIndex(), photon: (q: string, near: { lat: number; lng: number } | null) => photonSearch(q, near), allow: async () => true };
    const results: QueryResult[] = [];
    const probes: Probe[] = [];
    for (const q of queries.slice(0, limit)) {
      const t0 = performance.now();
      const r = await readInstant(q.query, null, deps as never, Date.now());
      results.push(scoreQuery(q, answerFromInstant(r, performance.now() - t0)));
      await sleep(pause);
      if (q.expect.role === "attraction" || q.expect.role === "hours") {
        const hit = r.places.find((p) => p.place && q.expect.entity && matchesEntity({ said: p.said, status: p.status, name: p.place.name, kind: p.place.kind, state: p.place.state, alternatives: p.alternatives.length }, q.expect.entity).ok);
        if (hit?.place) {
          const got = await probe(hit.place.id);
          const t = got === "unavailable" ? {} : got.tags;
          probes.push({ query: q.query, osmId: hit.place.id, outcome: got === "unavailable" ? (hit.place.id.startsWith("osm:") ? "unavailable" : "not_a_map_object") : "tags",
            tags: { openingHours: !!t.opening_hours, serviceTimes: !!t.service_times, hoursUrl: !!t["opening_hours:url"], website: !!(t.website || t["contact:website"]), wikidata: !!t.wikidata, wikipedia: !!t.wikipedia, checkDate: !!t.check_date }, openingHoursText: t.opening_hours ?? null });
          await sleep(pause);
        }
      }
    }
    const tagged = probes.filter((p) => p.outcome === "tags");
    const share = (f: (p: Probe) => boolean) => ({ num: tagged.filter(f).length, den: tagged.length, pct: tagged.length ? Math.round((tagged.filter(f).length / tagged.length) * 1000) / 10 : null });
    const report = {
      schema: 1, mode: "live", ranAt: new Date().toISOString().slice(0, 10), queriesRun: results.length,
      place: { summary: summarize(results), byGroup: byGroup(results), failures: results.filter(isFailure) },
      hoursTagPresence: { note: "PRESENCE of a tag on the matched OpenStreetMap object. Not correctness, and not freshness.", probed: probes.length, answered: tagged.length, unavailable: probes.filter((p) => p.outcome === "unavailable").length, notMapObject: probes.filter((p) => p.outcome === "not_a_map_object").length,
        openingHours: share((p) => p.tags.openingHours), serviceTimes: share((p) => p.tags.serviceTimes), hoursUrl: share((p) => p.tags.hoursUrl), website: share((p) => p.tags.website), wikidata: share((p) => p.tags.wikidata), anyHoursInformation: share((p) => p.tags.openingHours || p.tags.serviceTimes || p.tags.hoursUrl) },
      probes,
    };
    mkdirSync(new URL("../reports/place-intel/", import.meta.url), { recursive: true });
    writeFileSync(new URL("../reports/place-intel/live-baseline.json", import.meta.url), JSON.stringify(report, null, 1) + "\n");
    const pc = (r: { num: number; den: number; pct: number | null }) => (r.pct === null ? "n/a" : `${r.pct}% (${r.num}/${r.den})`);
    const h = report.hoursTagPresence;
    writeFileSync(new URL("../reports/place-intel/live-baseline.md", import.meta.url), [
      `# Live baseline (${report.ranAt})`, "", `${report.queriesRun} queries through the real place search (India index + OpenStreetMap search).`, "",
      `- Labelled place found: ${pc(report.place.summary.entityFound)}`, `- Right kind of place: ${pc(report.place.summary.roleCorrect)}`, `- Ambiguous: asked ${pc(report.place.summary.ambiguityHandled)}, silently guessed ${pc(report.place.summary.silentGuesses)}`, "",
      "## Hours-related tags on the matched OpenStreetMap objects (presence only)", "", `Objects probed: ${h.probed}; answered: ${h.answered}; map servers unavailable for: ${h.unavailable}; not a map object: ${h.notMapObject}.`, "",
      `| Tag | Present |`, `|---|---|`, `| opening_hours | ${pc(h.openingHours)} |`, `| service_times | ${pc(h.serviceTimes)} |`, `| opening_hours:url | ${pc(h.hoursUrl)} |`, `| website | ${pc(h.website)} |`, `| wikidata | ${pc(h.wikidata)} |`, `| any hours information | ${pc(h.anyHoursInformation)} |`, "",
      "Presence is not correctness: a tag can be wrong or out of date. Correctness needs hand-copied entries in hours-truth.json.", ""].join("\n"));
    expect(results.length).toBe(Math.min(limit, queries.length));
  }, 30 * 60_000);
});

describe("the live run", () => {
  it("is switched off unless PLACE_INTEL_LIVE=1, and never runs in CI", () => {
    expect(typeof LIVE).toBe("boolean");
    if (process.env.CI) expect(LIVE).toBe(false);
  });
});
