// What "a place worth a trip" means, in OpenStreetMap's own tags. One table drives three things so they can never disagree:
//   the Overpass query (which selectors to fetch), the classifier (which category a fetched place belongs to) and the filter chips.
// Selectors are written here, never taken from user input.

export type ExploreCategoryId = "fort" | "temple" | "waterfall" | "beach" | "wildlife" | "lake" | "museum" | "viewpoint" | "heritage" | "peak";

export type ExploreCategory = {
  id: ExploreCategoryId;
  label: string;
  /** Overpass tag filters; every one also requires a name (an unnamed place cannot be recommended). */
  selectors: readonly string[];
  /**
   * Heavy categories have tens of thousands of entries across a state (every shrine, every pond). For a whole region they are limited to
   * places OpenStreetMap links to Wikipedia, Wikidata or a heritage listing, i.e. places somebody found notable. Near a point they are not.
   */
  heavy: boolean;
};

export const EXPLORE_CATEGORIES: readonly ExploreCategory[] = [
  { id: "fort", label: "Forts & palaces", selectors: ['["historic"~"^(fort|castle)$"]["name"]'], heavy: false },
  { id: "temple", label: "Temples & religious sites", selectors: ['["amenity"="place_of_worship"]["name"]', '["building"="temple"]["name"]'], heavy: true },
  // OpenStreetMap's usual tag for a waterfall is waterway=waterfall (natural=waterfall is the rarer one): both are asked for.
  { id: "waterfall", label: "Waterfalls", selectors: ['["natural"="waterfall"]["name"]', '["waterway"="waterfall"]["name"]'], heavy: false },
  { id: "beach", label: "Beaches", selectors: ['["natural"="beach"]["name"]'], heavy: false },
  { id: "wildlife", label: "Wildlife & parks", selectors: ['["boundary"="national_park"]["name"]', '["leisure"="nature_reserve"]["name"]', '["tourism"="zoo"]["name"]'], heavy: false },
  { id: "lake", label: "Lakes & dams", selectors: ['["natural"="water"]["water"~"^(lake|reservoir)$"]["name"]', '["waterway"="dam"]["name"]'], heavy: true },
  { id: "museum", label: "Museums & caves", selectors: ['["tourism"="museum"]["name"]', '["natural"="cave_entrance"]["name"]'], heavy: true },
  { id: "viewpoint", label: "Viewpoints", selectors: ['["tourism"="viewpoint"]["name"]'], heavy: true },
  { id: "heritage", label: "Heritage & monuments", selectors: ['["historic"~"^(monument|archaeological_site|ruins|memorial|palace)$"]["name"]', '["tourism"="attraction"]["name"]'], heavy: true },
  { id: "peak", label: "Hills & peaks", selectors: ['["natural"="peak"]["name"]'], heavy: true },
];

export const EXPLORE_CATEGORY_IDS = EXPLORE_CATEGORIES.map((c) => c.id) as [ExploreCategoryId, ...ExploreCategoryId[]];
export const exploreCategory = (id: string): ExploreCategory | null => EXPLORE_CATEGORIES.find((c) => c.id === id) ?? null;
export const exploreCategoryLabel = (id: ExploreCategoryId) => exploreCategory(id)?.label ?? id;

/** Which category a fetched place belongs to (first match wins: the most specific kinds are checked first), or null. */
export function classifyExplore(tags: Record<string, string>): ExploreCategoryId | null {
  if (tags.natural === "waterfall" || tags.waterway === "waterfall") return "waterfall";
  if (tags.natural === "beach") return "beach";
  if (/^(fort|castle)$/.test(tags.historic ?? "")) return "fort";
  if (tags.boundary === "national_park" || tags.leisure === "nature_reserve" || tags.tourism === "zoo") return "wildlife";
  if (tags.tourism === "museum" || tags.natural === "cave_entrance") return "museum";
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (tags.natural === "peak") return "peak";
  if ((tags.natural === "water" && /^(lake|reservoir)$/.test(tags.water ?? "")) || tags.waterway === "dam") return "lake";
  if (tags.amenity === "place_of_worship" || tags.building === "temple") return "temple";
  if (/^(monument|archaeological_site|ruins|memorial|palace)$/.test(tags.historic ?? "") || tags.tourism === "attraction") return "heritage";
  return null;
}
