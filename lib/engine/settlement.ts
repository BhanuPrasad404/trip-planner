// Is this "place" a sight, or a town / city? A traveller writes "Nalgonda" or "Vizag" the same way they write "Kailasagiri", but they are
// different things to plan: a town is somewhere you pass through or sleep (nothing to "visit" for hours), a city is many sights, a temple
// or a beach is one sight with a known time. Without this, every unknown name got one hour as if it were a monument.
//
// The rule uses only real data: our India place index (GeoNames, with populations). A place counts as a settlement only when its NAME
// matches a city/town/village within a few km of it, so a sight inside a city ("Charminar" in Hyderabad) is never mistaken for the city.
// The traveller's own time at a place and any known kind of place (temple, beach…) always win.
import type { BuilderPlace } from "@/lib/trip-builder/types";

export type Settlement = "city" | "town";
export type Nearby = { name: string; otherNames?: string[]; kind: string; pop: number; km: number };

/** A city this big is many sights; smaller places are towns (Nalgonda ≈ 1.6 lakh, Tirupati ≈ 3.7 lakh, Vizag ≈ 20 lakh). */
export const CITY_MIN_POP = 300_000;
/** A town: a short stop (tea, fuel, a look around). A city: time in the city until the traveller adds the sights they want there. */
export const SETTLEMENT_VISIT_MIN: Record<Settlement, number> = { town: 30, city: 120 };
/** The settlement must be this close to the point the traveller picked. */
export const SETTLEMENT_MATCH_KM = 6;
export const SETTLEMENT_KINDS = ["city", "town", "locality", "subdistrict", "district"] as const;

const norm = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(city|town|district|mandal|nagar palika|municipality)\b/g, "").replace(/[^a-z\u0900-\u0dff]/g, "");

/** Same name, allowing spelling variants ("Vizag"/"Visakhapatnam" via other names; "Nalgonda"/"Nalgonda town"; one or two letters off). */
export function sameName(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 5 && (x.startsWith(y) || y.startsWith(x))) return true;
  if (Math.min(x.length, y.length) < 6) return false;
  // at most 2 letters different (Levenshtein, early exit)
  const m = x.length, n = y.length;
  if (Math.abs(m - n) > 2) return false;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= n; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > 2) return false;
    prev = cur;
  }
  return prev[n] <= 2;
}

/** The settlement this place IS (not merely near), or null. Only for places whose kind is unknown and whose time the traveller hasn't set. */
export function settlementOf(p: Pick<BuilderPlace, "name" | "lat" | "lng" | "category" | "visitMin">, nearby: Nearby[]): { role: Settlement; pop: number } | null {
  if (p.category !== "other" || (p.visitMin ?? null) !== null) return null;
  const hit = nearby.find((c) => c.km <= SETTLEMENT_MATCH_KM && (SETTLEMENT_KINDS as readonly string[]).includes(c.kind) && [c.name, ...(c.otherNames ?? [])].some((n) => sameName(p.name, n)));
  if (!hit) return null;
  return { role: hit.pop >= CITY_MIN_POP ? "city" : "town", pop: hit.pop };
}

/** The places with towns and cities timed as what they are, and one plain note for each. */
export function markSettlements(places: BuilderPlace[], find: (lat: number, lng: number) => Nearby[]): { places: BuilderPlace[]; notes: string[] } {
  const notes: string[] = [];
  const out = places.map((p) => {
    const s = settlementOf(p, find(p.lat, p.lng));
    if (!s) return p;
    notes.push(s.role === "town"
      ? `${p.name} is a town, not a sight, so it is planned as a ${SETTLEMENT_VISIT_MIN.town}-minute stop (a break on the way, or where you stay). Add the places you want to see there.`
      : `${p.name} is a city with many things to see, not one sight. We kept about ${SETTLEMENT_VISIT_MIN.city / 60} hours for it: add the sights you want there (a beach, a temple, a viewpoint…) for a real plan.`);
    return { ...p, visitMin: SETTLEMENT_VISIT_MIN[s.role], settlement: s.role };
  });
  return { places: out, notes };
}
