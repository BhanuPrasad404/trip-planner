// Which OpenStreetMap feature (if any) is THIS trip stop, so we can suggest its opening hours?
//
// Conservative on purpose: a wrong match puts another place's hours on your stop, which is worse than no hours. So:
//   • only features that actually carry opening_hours are considered;
//   • a match needs a similar NAME and to be close (similar name within 250 m, or an almost identical name within 600 m for big sites);
//   • if two candidates qualify with DIFFERENT hours, we don't pick: the stop is "ambiguous" and stays without hours.
// The result is only ever a suggestion, labelled as map data, until a trip member confirms it.
//
// Same object first: when the stop and a candidate carry the same OpenStreetMap or Wikidata id, that is the match (names aside). Only
// then are names compared (lib/place-intel/names.ts: spelling variants, Indian scripts, other names; a restaurant, station or road
// named after a monument is never the monument).
import { distanceKm } from "@/lib/geo";
import { samePlaceScore } from "@/lib/place-intel/names";

export type PlaceIds = { osm?: string | null; wikidata?: string | null };
export type HoursCandidate = {
  ref: string; name: string | null; lat: number; lng: number; hours: string | null; /** when the map data was read */ fetchedAt?: string;
  /** Other names the data gives (alt_name, name:en, a Wikidata label…). */ aliases?: string[]; ids?: PlaceIds;
};
/** Same id, but further than this: the id is wrong somewhere, not a match. */
export const SAME_ID_MAX_M = 2_000;
/** The name rule, kept apart so the baseline can measure exactly what the app uses. */
export const hoursNameScore = (stop: string, candidate: string, aliases?: string[]) => samePlaceScore(stop, candidate, { aliasesB: aliases });
const sameId = (a: PlaceIds | undefined, b: PlaceIds | undefined) => !!a && !!b && ((!!a.osm && a.osm === b.osm) || (!!a.wikidata && a.wikidata === b.wikidata));

/** What the lookup did for each stop (POST /api/trips/[id]/hours/lookup). */
export type LookupOutcome =
  | { placeId: string; result: "found"; name: string; hours: string; ref: string; distanceM: number }
  | { placeId: string; result: "ambiguous"; names: string[] }
  | { placeId: string; result: "none" | "unreadable" | "map_loading" | "kept" };
export type HoursMatch =
  | { kind: "match"; candidate: HoursCandidate; distanceM: number; similarity: number; by?: "id" | "name" }
  | { kind: "ambiguous"; names: string[] }
  | { kind: "none" };

export const MATCH_RULES = { nearM: 250, farM: 600, minSimilarity: 0.6, farSimilarity: 0.85 } as const;

export function matchHours(stop: { name: string; lat: number; lng: number; ids?: PlaceIds }, candidates: HoursCandidate[]): HoursMatch {
  const byId = candidates.filter((c) => c.hours && Number.isFinite(c.lat) && Number.isFinite(c.lng) && sameId(stop.ids, c.ids) && distanceKm(stop, c) * 1000 <= SAME_ID_MAX_M);
  if (byId.length) {
    const hours = new Set(byId.map((c) => c.hours!.trim()));
    if (hours.size > 1) return { kind: "ambiguous", names: [...new Set(byId.map((c) => c.name ?? c.ref))].slice(0, 4) };
    const c = byId.sort((a, b) => distanceKm(stop, a) - distanceKm(stop, b) || a.ref.localeCompare(b.ref))[0];
    return { kind: "match", candidate: c, distanceM: Math.round(distanceKm(stop, c) * 1000), similarity: 1, by: "id" };
  }
  const ok: { c: HoursCandidate; d: number; s: number }[] = [];
  for (const c of candidates) {
    if (!c.hours || !c.name || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
    const d = distanceKm(stop, c) * 1000;
    const s = hoursNameScore(stop.name, c.name, c.aliases);
    if ((d <= MATCH_RULES.nearM && s >= MATCH_RULES.minSimilarity) || (d <= MATCH_RULES.farM && s >= MATCH_RULES.farSimilarity)) ok.push({ c, d, s });
  }
  if (ok.length === 0) return { kind: "none" };
  const distinctHours = new Set(ok.map((x) => x.c.hours!.trim()));
  if (distinctHours.size > 1) return { kind: "ambiguous", names: [...new Set(ok.map((x) => x.c.name!))].slice(0, 4) };
  // Same hours everywhere: take the closest, best-named one (deterministic: by similarity, then distance, then ref).
  ok.sort((a, b) => b.s - a.s || a.d - b.d || a.c.ref.localeCompare(b.c.ref));
  return { kind: "match", candidate: ok[0].c, distanceM: Math.round(ok[0].d), similarity: Math.round(ok[0].s * 100) / 100, by: "name" };
}
