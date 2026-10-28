// Builds the Overpass question for one scope (a state, or a circle around a point) and one category (or all).
// Only values that passed validation reach here, and the pieces that end up inside the query text are either from our own tables
// (selectors, ISO codes) or numbers formatted by us, so no user text is ever pasted into a query.
import { EXPLORE_CATEGORIES, exploreCategory, type ExploreCategory, type ExploreCategoryId } from "./categories";
import { pathLengthKm } from "@/lib/geo";
import { regionByCode } from "./regions";

/**
 * `route`: everything within `radius_km` of a road line ([lng, lat] points, at most MAX_ROUTE_POINTS: see lib/explore/route-scope.ts).
 * The corridor is the REAL remaining route, not a circle round the start.
 */
export type ExploreScope = { kind: "state"; code: string } | { kind: "point"; lat: number; lng: number; radius_km: number; /** Heavy kinds (every shrine, every pond) only when somebody found them notable: a much lighter question for a wide circle. */ notableOnly?: boolean } | { kind: "route"; line: [number, number][]; radius_km: number };

export const MAX_ROUTE_POINTS = 80;
/** A corridor longer than this asks for notable places only when the category is heavy or "all" (a 400 km road has thousands of shrines). */
const LONG_ROUTE_KM = 120;

/** A place somebody found notable: linked to Wikipedia or Wikidata, or listed as heritage. */
export const NOTABLE_FILTER = '[~"^(wikidata|wikipedia|heritage)$"~"."]';

const NOTABLE_LIMIT = 300;
const OTHER_LIMIT = 150;

/** One kind, several kinds (asked in ONE question to the map servers, not one question each), or all of them. */
export type ExploreKinds = ExploreCategoryId | "all" | readonly ExploreCategoryId[];
/** A short stable text for a set of kinds, for cache keys: "temple", "all", "fort+temple" (sorted, so the order asked never makes a second entry). */
export const kindsKey = (kinds: ExploreKinds): string => (typeof kinds === "string" ? kinds : [...new Set(kinds)].sort().join("+"));
const categoriesFor = (category: ExploreKinds): readonly ExploreCategory[] =>
  category === "all" ? EXPLORE_CATEGORIES : (typeof category === "string" ? [category] : [...new Set(category)]).map((c) => exploreCategory(c)).filter((c): c is ExploreCategory => !!c);

/**
 * The question. Two result groups are printed one after the other so the cap on each can never push a well-known place out:
 *   1. notable places (up to 300); 2. the rest (up to 150), only when the scope and category allow it.
 * A whole region with "all categories" or with a heavy category returns notable places only (see categories.ts).
 */
export function buildExploreQuery(scope: ExploreScope, category: ExploreKinds): string {
  const cats = categoriesFor(category);
  if (cats.length === 0) throw new Error("unknown explore category");
  let head: string;
  let where: string;
  if (scope.kind === "state") {
    const region = regionByCode(scope.code);
    if (!region) throw new Error("unknown region");
    const alt = region.iso.join("|");
    head = `area["boundary"="administrative"]["ISO3166-2"~"^IN-(${alt})$"]->.a;`;
    where = "(area.a)";
  } else if (scope.kind === "route") {
    const pts = scope.line;
    if (pts.length < 2 || pts.length > MAX_ROUTE_POINTS || !pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) throw new Error("bad route");
    if (!Number.isFinite(scope.radius_km)) throw new Error("bad route");
    const r = Math.round(Math.min(25, Math.max(1, scope.radius_km)) * 1000);
    head = "";
    // Overpass reads a list of coordinates in "around" as a line: everything within r metres of the road.
    where = `(around:${r},${pts.map(([lng, lat]) => `${lat.toFixed(4)},${lng.toFixed(4)}`).join(",")})`;
  } else {
    if (![scope.lat, scope.lng, scope.radius_km].every(Number.isFinite)) throw new Error("bad point");
    const r = Math.round(Math.min(50, Math.max(1, scope.radius_km)) * 1000);
    head = "";
    where = `(around:${r},${scope.lat.toFixed(5)},${scope.lng.toFixed(5)})`;
  }
  const longRoute = scope.kind === "route" && pathLengthKm(scope.line.map(([lng, lat]) => ({ lat, lng }))) > LONG_ROUTE_KM;
  const notableOnly = (scope.kind === "state" || longRoute) && (category === "all" || cats.every((c) => c.heavy));
  const lightQuery = scope.kind === "point" && scope.notableOnly === true;
  const union = cats.flatMap((c) => c.selectors.map((s) => `nwr${s}${lightQuery && c.heavy ? NOTABLE_FILTER : ""}${where};`)).join("");
  const lines = [`[out:json][timeout:40];`, head, `(${union})->.all;`, `nwr.all${NOTABLE_FILTER}->.n;`, `.n out center ${NOTABLE_LIMIT};`];
  if (!notableOnly) lines.push(`(.all; - .n;)->.o;`, `.o out center ${OTHER_LIMIT};`);
  return lines.filter(Boolean).join("\n");
}
