// "Places like these": once the traveller has 2+ places, up to 6 REAL places with a similar feel, each with its reason and the real extra
// drive to fit it into the trip. Optional — nothing is added by itself.
// Where they come from, and what "similar" honestly means:
//   • OpenStreetMap places somebody found notable (linked to Wikipedia / Wikidata, or listed as heritage), from Explore's shared,
//     cached state lists — "similar" = the same kind of place (another waterfall, another fort) or a kind matching an interest.
//   • Our own researched places (with the months they are good in), and the traveller's saved places.
// Food and shopping have no reliable free data, so they never produce suggestions.
import { distanceKm } from "@/lib/geo";
import type { ExploreCategoryId } from "@/lib/explore/categories";
import type { ExploreItem } from "@/lib/explore/items";
import { REGIONS } from "@/lib/explore/regions";
import { normalizeName } from "@/lib/places/types";
import { categoryFor, type Matrix, type MeterPlace } from "./fit-meter";
import { INTEREST_LABEL, type Interest } from "./types";
import { monthWindow } from "@/lib/landing-sample";

export const MAX_SUGGESTIONS = 6;
export const MIN_PLACES = 2;
/** Look this far around the trip's places. */
export const NEAR_TRIP_KM = 120;
/** A suggestion that adds more driving than this is not "like these", it's another trip. */
export const MAX_EXTRA_DRIVE_MIN = 150;
const MAX_KINDS = 3;
const MAX_STATES = 2;

export type Candidate = { id: string; name: string; lat: number; lng: number; kind: ExploreCategoryId | "researched" | "saved"; source: "osm" | "trailmate" | "saved"; months?: number[]; wikipedia?: string | null };
export type Suggestion = Candidate & { reason: string; extraDriveMin: number | null; extraKm: number | null; estimated: boolean };

/** The trip's kinds of place as Explore categories ("Bogatha Waterfall" → waterfall). */
const KIND_OF: Partial<Record<ReturnType<typeof categoryFor>, ExploreCategoryId>> = { waterfall: "waterfall", temple: "temple", fort: "fort", beach: "beach", lake: "lake", museum: "museum", viewpoint: "viewpoint", wildlife: "wildlife" };
const INTEREST_KINDS: Partial<Record<Interest, ExploreCategoryId[]>> = { nature: ["waterfall", "lake", "viewpoint"], temples: ["temple"], history: ["fort", "heritage"], beaches: ["beach"], adventure: ["peak", "waterfall"], photography: ["viewpoint"], offbeat: ["waterfall", "peak"] };
const KIND_WORD: Record<ExploreCategoryId, string> = { fort: "fort", temple: "temple", waterfall: "waterfall", beach: "beach", wildlife: "wildlife park", lake: "lake", museum: "museum or cave", viewpoint: "viewpoint", heritage: "heritage site", peak: "hill" };

/** Which kinds to look for: the kinds already chosen first, then the interests. At most 3. */
export function kindsToFind(places: MeterPlace[], interests: Interest[]): { kind: ExploreCategoryId; like: string | null; interest: Interest | null }[] {
  const out: { kind: ExploreCategoryId; like: string | null; interest: Interest | null }[] = [];
  for (const p of places) { const k = KIND_OF[categoryFor(p)]; if (k && !out.some((o) => o.kind === k)) out.push({ kind: k, like: p.name, interest: null }); }
  for (const i of interests) for (const k of INTEREST_KINDS[i] ?? []) if (!out.some((o) => o.kind === k)) out.push({ kind: k, like: null, interest: i });
  return out.slice(0, MAX_KINDS);
}

/** The Explore region codes of the states the trip's places are in (most places first). */
export function statesOf(places: { state: string | null }[]): string[] {
  const count = new Map<string, number>();
  for (const p of places) {
    const n = normalizeName(p.state ?? "");
    const r = n ? REGIONS.find((x) => { const rn = normalizeName(x.name); return rn === n || rn.startsWith(n) || n.startsWith(rn); }) : null;
    if (r) count.set(r.code, (count.get(r.code) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, MAX_STATES);
}

/**
 * The real extra driving to slot each candidate into the trip. `matrix` rows/cols: [start, ...route (in visiting order), ...candidates].
 * Extra = the cheapest "go there and rejoin" between two neighbours of the route (or after the last place). Minutes and km.
 */
export function insertionCosts(matrix: Matrix, routeLen: number, candidates: number, roundTrip: boolean): { min: number; km: number }[] {
  const D = (a: number, b: number) => matrix.durations[a][b] / 60, K = (a: number, b: number) => matrix.distances[a][b] / 1000;
  const route = [0, ...Array.from({ length: routeLen }, (_, i) => i + 1), ...(roundTrip ? [0] : [])];
  return Array.from({ length: candidates }, (_, j) => {
    const c = 1 + routeLen + j;
    let best = { min: Infinity, km: Infinity };
    for (let i = 0; i < route.length; i++) {
      const a = route[i], b = route[i + 1];
      const min = b === undefined ? D(a, c) : D(a, c) + D(c, b) - D(a, b);
      const km = b === undefined ? K(a, c) : K(a, c) + K(c, b) - K(a, b);
      if (min < best.min) best = { min, km };
    }
    return { min: Math.max(0, Math.round(best.min)), km: Math.max(0, Math.round(best.km)) };
  });
}

/** Near the trip, not already chosen, and with a reason. Pure: the caller fetched the candidates and their extra drive. */
export function pickSimilar(args: {
  places: MeterPlace[];
  candidates: Candidate[];
  kinds: ReturnType<typeof kindsToFind>;
  month: number | null;
  extra: Map<string, { min: number; km: number }> | null;
  estimated: boolean;
}): Suggestion[] {
  const { places, kinds, month } = args;
  if (places.length < MIN_PLACES) return [];
  const chosen = (c: Candidate) => places.some((p) => distanceKm(p, c) < 2 || normalizeName(p.name) === normalizeName(c.name));
  const near = (c: Candidate) => places.some((p) => distanceKm(p, c) <= NEAR_TRIP_KM);
  const scored: (Suggestion & { score: number })[] = [];
  for (const c of args.candidates) {
    if (chosen(c) || !near(c)) continue;
    let reason: string | null = null, score = 0;
    const k = c.kind === "researched" || c.kind === "saved" ? null : kinds.find((x) => x.kind === c.kind);
    if (k?.like) { reason = `Another ${KIND_WORD[k.kind]}, like ${k.like}`; score = 3; }
    else if (k?.interest) { reason = `Matches your interest: ${INTEREST_LABEL[k.interest]}`; score = 2; }
    if (c.kind === "researched") {
      const good = month !== null && (c.months ?? []).includes(month);
      if (!good) continue; // our research says it's not the season: not a suggestion this month
      reason = `Researched by Trailmate: good in ${monthWindow(c.months!)}`; score = 3;
    }
    if (c.kind === "saved") { reason = "You saved this place"; score = 2.5; }
    if (!reason) continue;
    const x = args.extra?.get(c.id) ?? null;
    if (x && x.min > MAX_EXTRA_DRIVE_MIN) continue;
    scored.push({ ...c, reason, score, extraDriveMin: x?.min ?? null, extraKm: x?.km ?? null, estimated: args.estimated });
  }
  // One per name (a temple listed twice), best reason first, then the least extra driving.
  const seen = new Set<string>();
  return scored
    .sort((a, b) => b.score - a.score || (a.extraDriveMin ?? 999) - (b.extraDriveMin ?? 999) || a.name.localeCompare(b.name))
    .filter((s) => { const n = normalizeName(s.name); if (seen.has(n)) return false; seen.add(n); return true; })
    .slice(0, MAX_SUGGESTIONS)
    .map(({ score: _s, ...s }) => { void _s; return s; });
}

/** Explore items → candidates: only places somebody found notable. */
export const fromExplore = (items: ExploreItem[]): Candidate[] => items.filter((i) => i.notable).map((i) => ({ id: `osm:${i.id}`, name: i.name, lat: i.lat, lng: i.lng, kind: i.category, source: "osm", wikipedia: i.wikipedia }));
