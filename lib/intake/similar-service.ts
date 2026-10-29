// Gathering "places like these" (lib/intake/similar.ts decides; this fetches). Outside services are injected so tests use fakes.
import type { ExploreCategoryId } from "@/lib/explore/categories";
import type { ExploreItem } from "@/lib/explore/items";
import { distanceKm } from "@/lib/geo";
import { optimizeOpenPath } from "@/lib/trip-builder/tour";
import type { Matrix, MeterPlace } from "./fit-meter";
import { MIN_PLACES, NEAR_TRIP_KM, fromExplore, insertionCosts, kindsToFind, pickSimilar, statesOf, type Candidate, type Suggestion } from "./similar";
import type { Interest } from "./types";

export type SimilarDeps = {
  /**
   * Explore's shared, cached list for a state and SEVERAL kinds in one question (may call OpenStreetMap once, then cached for everyone).
   * Throws when unavailable. One question per state, never one per kind: the free servers allow about two at a time.
   */
  explore: (stateCode: string, kinds: ExploreCategoryId[]) => Promise<ExploreItem[]>;
  researched: () => Promise<{ id: string; name: string; lat: number; lng: number; months: number[] }[]>;
  saved: () => Promise<{ key: string; name: string; lat: number; lng: number }[]>;
  matrix: (points: { lat: number; lng: number }[]) => Promise<Matrix>;
};
export type SimilarAnswer = { suggestions: Suggestion[]; status: "ok" | "too_few" | "partial"; note: string | null };
const MAX_CANDIDATES_ROUTED = 24;
/**
 * The public OpenStreetMap servers can take a minute or fail (we measured 60 s with every mirror failing). We wait at most this long;
 * a slow request keeps running and fills the shared cache, so the next traveller (or a retry) gets the list instantly.
 */
export const EXPLORE_WAIT_MS = 20_000;
const within = <T,>(p: Promise<T>, ms: number): Promise<T> => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error("slow")), ms); })]).finally(() => clearTimeout(t));
};

export async function findSimilar(input: { start: { lat: number; lng: number }; places: (MeterPlace & { state: string | null })[]; interests: Interest[]; month: number | null; roundTrip: boolean }, deps: SimilarDeps, waitMs = EXPLORE_WAIT_MS): Promise<SimilarAnswer> {
  const { start, places } = input;
  if (places.length < MIN_PLACES) return { suggestions: [], status: "too_few", note: null };
  const kinds = kindsToFind(places, input.interests);
  const states = statesOf(places);
  let partial = false;
  const wanted = [...new Set(kinds.map((k) => k.kind))];
  const lists = wanted.length === 0 ? [] : await Promise.all(states.map((s) => within(deps.explore(s, wanted), waitMs).catch(() => { partial = true; return [] as ExploreItem[]; })));
  const [researched, saved] = await Promise.all([deps.researched().catch(() => []), deps.saved().catch(() => [])]);
  const candidates: Candidate[] = [
    ...fromExplore(lists.flat()),
    ...researched.map((r) => ({ id: `season:${r.id}`, name: r.name, lat: r.lat, lng: r.lng, kind: "researched" as const, source: "trailmate" as const, months: r.months })),
    ...saved.map((s) => ({ id: `saved:${s.key}`, name: s.name, lat: s.lat, lng: s.lng, kind: "saved" as const, source: "saved" as const })),
  ];
  // Only what could be suggested at all (near the trip) gets a road-time check: the closest few to the trip's places.
  const near = candidates
    .map((c) => ({ c, km: Math.min(...places.map((p) => distanceKm(p, c))) }))
    .filter((x) => x.km <= NEAR_TRIP_KM && x.km > 1)
    .sort((a, b) => a.km - b.km)
    .slice(0, MAX_CANDIDATES_ROUTED)
    .map((x) => x.c);

  let extra: Map<string, { min: number; km: number }> | null = null;
  let estimated = false;
  if (near.length) {
    try {
      // Visiting order for the extra-drive estimate: the shortest road order from the start (same optimiser the planner uses).
      const base = await deps.matrix([start, ...places]);
      const order = optimizeOpenPath({ nodes: places.map((_, i) => i + 1), start: 0, d: base.durations });
      const route = order.map((i) => places[i - 1]);
      const m = await deps.matrix([start, ...route, ...near]);
      estimated = m.source === "estimate";
      const costs = insertionCosts(m, route.length, near.length, input.roundTrip);
      extra = new Map(near.map((c, j) => [c.id, costs[j]]));
    } catch { partial = true; }
  }
  const suggestions = pickSimilar({ places, candidates: near, kinds, month: input.month, extra, estimated });
  return {
    suggestions, status: partial ? "partial" : "ok",
    note: partial ? "Some map data couldn't be reached just now, so there may be more places than shown." : suggestions.length === 0 ? "No notable places of the same kind near your trip in the map data." : null,
  };
}
