// Which OpenStreetMap feature (if any) is THIS trip stop, so we can suggest its opening hours?
//
// Conservative on purpose: a wrong match puts another place's hours on your stop, which is worse than no hours. So:
//   • only features that actually carry opening_hours are considered;
//   • a match needs a similar NAME and to be close (similar name within 250 m, or an almost identical name within 600 m for big sites);
//   • if two candidates qualify with DIFFERENT hours, we don't pick: the stop is "ambiguous" and stays without hours.
// The result is only ever a suggestion, labelled as map data, until a trip member confirms it.
import { distanceKm } from "@/lib/geo";
import { nameSimilarity } from "@/lib/season-match";

export type HoursCandidate = { ref: string; name: string | null; lat: number; lng: number; hours: string | null; /** when the map data was read */ fetchedAt?: string };

/** What the lookup did for each stop (POST /api/trips/[id]/hours/lookup). */
export type LookupOutcome =
  | { placeId: string; result: "found"; name: string; hours: string; ref: string; distanceM: number }
  | { placeId: string; result: "ambiguous"; names: string[] }
  | { placeId: string; result: "none" | "unreadable" | "map_loading" | "kept" };
export type HoursMatch =
  | { kind: "match"; candidate: HoursCandidate; distanceM: number; similarity: number }
  | { kind: "ambiguous"; names: string[] }
  | { kind: "none" };

export const MATCH_RULES = { nearM: 250, farM: 600, minSimilarity: 0.6, farSimilarity: 0.85 } as const;

export function matchHours(stop: { name: string; lat: number; lng: number }, candidates: HoursCandidate[]): HoursMatch {
  const ok: { c: HoursCandidate; d: number; s: number }[] = [];
  for (const c of candidates) {
    if (!c.hours || !c.name || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
    const d = distanceKm(stop, c) * 1000;
    const s = nameSimilarity(stop.name, c.name);
    if ((d <= MATCH_RULES.nearM && s >= MATCH_RULES.minSimilarity) || (d <= MATCH_RULES.farM && s >= MATCH_RULES.farSimilarity)) ok.push({ c, d, s });
  }
  if (ok.length === 0) return { kind: "none" };
  const distinctHours = new Set(ok.map((x) => x.c.hours!.trim()));
  if (distinctHours.size > 1) return { kind: "ambiguous", names: [...new Set(ok.map((x) => x.c.name!))].slice(0, 4) };
  // Same hours everywhere: take the closest, best-named one (deterministic: by similarity, then distance, then ref).
  ok.sort((a, b) => b.s - a.s || a.d - b.d || a.c.ref.localeCompare(b.c.ref));
  return { kind: "match", candidate: ok[0].c, distanceM: Math.round(ok[0].d), similarity: Math.round(ok[0].s * 100) / 100 };
}
