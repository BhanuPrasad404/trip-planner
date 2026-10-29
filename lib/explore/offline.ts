// Places from our OWN offline list (the GeoNames India index in data/geo), for when the live map servers cannot be reached and nothing is
// saved: a short, honest list instead of an empty screen. Pure: the index is passed in.
//
// The offline list keeps only the kind of a place (sight / water / coast / park), not what it is, and many entries are obscure (village
// ponds, forest plantations, names with no type at all). So a place is used ONLY when its own name says what it is ("... Fort",
// "... Falls", "... Beach", "... National Park"), and that word decides the category. Nothing here is called well known (notable: false):
// being in a gazetteer says it exists, not that it is worth a trip. Hills are left out: thousands of unnamed-in-practice hillocks.
import { distanceKm, pathLengthKm } from "@/lib/geo";
import type { GeoIndex } from "@/lib/places/geo-index";
import type { ExploreCategoryId } from "./categories";
import type { ExploreItem } from "./items";
import type { ExploreKinds, ExploreScope } from "./query";
import { regionByCode } from "./regions";

type Rule = { re: RegExp; category: ExploreCategoryId; kinds: readonly string[] };
// Checked in order; the first match wins. Words are whole words (Indian-language ones as people write them in English letters).
const RULES: readonly Rule[] = [
  { re: /\b(falls?|jalapatham|jalpatham|jharna|duduma)\b/i, category: "waterfall", kinds: ["water"] },
  { re: /\b(fort|kota|qila|killa|kille|durg|palace|mahal)\b/i, category: "fort", kinds: ["sight"] },
  { re: /\b(museum|caves?|guha)\b/i, category: "museum", kinds: ["sight", "park"] },
  { re: /\b(national park|wildlife sanctuary|bird sanctuary|tiger reserve|sanctuary|zoo|zoological park)\b/i, category: "wildlife", kinds: ["park", "sight"] },
  { re: /\b(beach)\b/i, category: "beach", kinds: ["coast"] },
  { re: /\b(temple|mandir|mandiram|gudi|kovil|koil|devalayam|devasthanam|math|mutt|gurudwara|gurdwara|monastery|gompa|church|cathedral|basilica|mosque|masjid|dargah)\b/i, category: "temple", kinds: ["sight"] },
  { re: /\b(lake|sagar|sarovar|reservoir|dam)\b/i, category: "lake", kinds: ["water"] },
  { re: /\b(point|nose|view ?point)\b/i, category: "viewpoint", kinds: ["coast", "sight"] },
  { re: /\b(monument|memorial|tomb|maqbara|stupa|ruins|minar|gate|darwaza|stepwell|baoli|vav)\b/i, category: "heritage", kinds: ["sight"] },
];

/** The category a place's own name gives it, or null when the name does not say. */
export function categoryFromName(name: string, kind: string): ExploreCategoryId | null {
  for (const r of RULES) if (r.kinds.includes(kind) && r.re.test(name)) return r.category;
  return null;
}

const MAX_ITEMS = 120;
/** Wider than this, a circle is not a "nearby" question. */
const MAX_POINT_KM = 60;
const MAX_ROUTE_KM = 25;

const wanted = (kinds: ExploreKinds): Set<ExploreCategoryId> | null => (kinds === "all" ? null : new Set(typeof kinds === "string" ? [kinds as ExploreCategoryId] : kinds));

/** Distance (km) from a point to a road line given as [lng, lat] points: the nearest of the points and the segments between them. */
function kmToLine(p: { lat: number; lng: number }, line: [number, number][]): number {
  let best = Infinity;
  const kx = 111.32 * Math.cos((p.lat * Math.PI) / 180), ky = 110.57;
  for (let i = 0; i < line.length; i++) {
    const [ax, ay] = [(line[i][0] - p.lng) * kx, (line[i][1] - p.lat) * ky];
    if (i === line.length - 1) { best = Math.min(best, Math.hypot(ax, ay)); break; }
    const [bx, by] = [(line[i + 1][0] - p.lng) * kx, (line[i + 1][1] - p.lat) * ky];
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** The offline places for a scope and kinds, best first (closest for a circle or a road; by category then name for a state). */
export function offlineExplore(ix: GeoIndex, scope: ExploreScope, kinds: ExploreKinds): ExploreItem[] {
  const want = wanted(kinds);
  if (want && want.size === 0) return [];
  let inScope: (e: GeoIndex["entries"][number]) => number | null;          // null = outside; otherwise a sort distance
  if (scope.kind === "state") {
    const region = regionByCode(scope.code);
    if (!region) return [];
    const name = region.name.toLowerCase();
    inScope = (e) => (e.state && e.state.toLowerCase().startsWith(name.split(" and ")[0]) ? 0 : null);
  } else if (scope.kind === "point") {
    const r = Math.min(MAX_POINT_KM, Math.max(1, scope.radius_km));
    inScope = (e) => { const km = distanceKm(scope, e); return km <= r ? km : null; };
  } else {
    if (scope.line.length < 2 || pathLengthKm(scope.line.map(([lng, lat]) => ({ lat, lng }))) <= 0) return [];
    const r = Math.min(MAX_ROUTE_KM, Math.max(1, scope.radius_km));
    const lats = scope.line.map((p) => p[1]), lngs = scope.line.map((p) => p[0]);
    const pad = r / 100;
    const [s, n, w, ea] = [Math.min(...lats) - pad, Math.max(...lats) + pad, Math.min(...lngs) - pad, Math.max(...lngs) + pad];
    inScope = (e) => { if (e.lat < s || e.lat > n || e.lng < w || e.lng > ea) return null; const km = kmToLine(e, scope.line); return km <= r ? km : null; };
  }
  const out: (ExploreItem & { d: number })[] = [];
  for (const e of ix.entries) {
    if (e.kind !== "sight" && e.kind !== "water" && e.kind !== "coast" && e.kind !== "park") continue;
    const d = inScope(e);
    if (d === null) continue;
    const category = categoryFromName(e.name, e.kind);
    if (!category || (want && !want.has(category))) continue;
    out.push({ id: `gn:${e.i}`, origin: "geonames", name: e.name, category, lat: e.lat, lng: e.lng, notable: false, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null, d });
  }
  out.sort((a, b) => a.d - b.d || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return out.slice(0, MAX_ITEMS).map(({ d: _d, ...item }) => item);
}
