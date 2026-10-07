import { distanceKm } from "@/lib/geo";

export type SeasonTagLite = {
  id: string;
  place_name: string;
  lat: number;
  lng: number;
  category: string | null;
  good_months: number[];
  reason: string | null;
};

const STOP_WORDS = new Set(["the", "of", "and", "in", "near", "at", "a"]);

// Generic "type" words. Names are compared on their DISTINCTIVE words ("Kalu"), and two names
// whose type words conflict ("Kalu Waterfall" vs "Kalu Dam") never match.
const TYPE_GROUPS: Record<string, string[]> = {
  waterfall: ["waterfall", "waterfalls", "falls", "fall"],
  fort: ["fort", "fortress", "killa", "gad"],
  lake: ["lake", "dam", "reservoir"],
  viewpoint: ["viewpoint", "point", "view"],
  beach: ["beach"],
  temple: ["temple", "mandir"],
  park: ["park", "sanctuary", "reserve"],
};
const TYPE_OF = new Map<string, string>();
for (const [group, words] of Object.entries(TYPE_GROUPS)) for (const w of words) TYPE_OF.set(w, group);

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019`]/g, "") // "Tiger's" -> "tigers" (don't split into "tiger s")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parts(s: string): { distinctive: Set<string>; types: Set<string> } {
  const distinctive = new Set<string>();
  const types = new Set<string>();
  for (const t of normalizeName(s).split(" ")) {
    if (!t || STOP_WORDS.has(t)) continue;
    const group = TYPE_OF.get(t);
    if (group) types.add(group);
    else distinctive.add(t);
  }
  return { distinctive, types };
}

/** 0..1 name similarity. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const pa = parts(a);
  const pb = parts(b);
  // Conflicting types ("... Waterfall" vs "... Dam") are different places.
  if (pa.types.size && pb.types.size && ![...pa.types].some((t) => pb.types.has(t))) return 0;

  if (pa.distinctive.size === 0 || pb.distinctive.size === 0) return na.includes(nb) || nb.includes(na) ? 0.85 : 0;
  const inter = [...pa.distinctive].filter((t) => pb.distinctive.has(t)).length;
  const union = new Set([...pa.distinctive, ...pb.distinctive]).size;
  const jaccard = inter / union;
  if (jaccard === 1) return 0.9; // same distinctive words, compatible types
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  return jaccard;
}

const MAX_MATCH_KM = 25;

/** Match a place to curated season data by NAME (required) and proximity (when we have coordinates). */
export function matchSeasonTag(
  place: { name: string; lat: number | null; lng: number | null },
  tags: SeasonTagLite[]
): SeasonTagLite | null {
  let best: { tag: SeasonTagLite; score: number; km: number } | null = null;
  for (const tag of tags) {
    const sim = nameSimilarity(place.name, tag.place_name);
    if (sim < 0.5) continue;
    let km = 0;
    if (place.lat != null && place.lng != null) {
      km = distanceKm({ lat: place.lat, lng: place.lng }, tag);
      if (km > MAX_MATCH_KM) continue;
    }
    if (!best || sim > best.score || (sim === best.score && km < best.km)) best = { tag, score: sim, km };
  }
  return best?.tag ?? null;
}
