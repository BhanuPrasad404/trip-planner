// What LEVEL of place is this, and can it have opening hours at all? A city, a town, a valley or a district has no opening time; a temple,
// a fort or a museum may. Decided from data only: the kind our India index or the map search gives (with population), the catalogue's
// kind, the Wikidata type and the OpenStreetMap tag it was found under, and how many places say they are part of it. No place is named
// here. When the data is thin the answer says so (confidence "low", or role "unknown"), never a confident guess.
import { ROOTS } from "@/lib/catalog/wikidata";
import type { ExploreCategoryId } from "@/lib/explore/categories";
import type { PlaceKind } from "@/lib/places/types";

export type PlaceRole = "settlement" | "area" | "site" | "complex" | "unknown";
export type RoleConfidence = "high" | "medium" | "low";
/**
 * Whether opening hours make sense for it:
 *   not_applicable      a settlement or an area: no single opening time (its sights may have one)
 *   applicable          a place that may keep hours (a temple, a fort, a museum, a park with gates)
 *   open_access_likely  usually open ground (a beach, a peak, a viewpoint, a lake): a hint, never a promise
 *   per_part            a complex: each part may keep its own hours
 *   unknown             we can't tell what it is
 */
export type HoursFit = "not_applicable" | "applicable" | "open_access_likely" | "per_part" | "unknown";

export type RoleEvidence = {
  name: string;
  /** Our India index (GeoNames) or the map search's kind of place. */
  kind?: PlaceKind | null;
  /** From our India index, for towns and cities. */
  population?: number | null;
  /** The catalogue's kind (lib/explore/categories.ts). */
  category?: ExploreCategoryId | null;
  /** Wikidata place type the catalogue found it under ("Q39816"). */
  wdType?: string | null;
  /** OpenStreetMap tag that made it a catalogue place ("historic=fort"). */
  osmType?: string | null;
  /** Raw OpenStreetMap tags, when a map answer carries them. */
  osmTags?: Record<string, string> | null;
  /** Places that belong to it: by Wikidata "part of" links, or by sitting inside it under its name. */
  parts?: { count: number; by: "wikidata" | "name" } | null;
};

export type RoleAnswer = { role: PlaceRole; confidence: RoleConfidence; hours: HoursFit; /** Plain words: why we think so (the data, not a list). */ reasons: string[] };

/** Wikidata types (lib/catalog/wikidata.ts ROOTS) that are a stretch of country, not one place: no opening time. */
export const AREA_WD_TYPES: Readonly<Record<string, string>> = { Q39816: "a valley" };
/** Wikidata types that are usually open ground. */
export const OPEN_WD_TYPES: Readonly<Record<string, string>> = { Q40080: "a beach", Q6017969: "a viewpoint", Q8502: "a mountain", Q54050: "a hill", Q23397: "a lake", Q131681: "a reservoir" };
/** OpenStreetMap tags for the same two groups. */
const AREA_OSM = /^(natural=valley|place=(district|county|state|region|province|municipality|island|archipelago)|boundary=administrative)$/;
const OPEN_OSM = /^(natural=(beach|peak|water|hill)|tourism=viewpoint|water=(lake|reservoir))$/;
const OPEN_CATEGORIES: ReadonlySet<ExploreCategoryId> = new Set(["beach", "viewpoint", "peak", "lake"]);

const SETTLEMENT_PLACE = /^(city|town|village|hamlet|suburb|neighbourhood|quarter|borough|locality|isolated_dwelling)$/;
const AREA_PLACE = /^(district|county|state|region|province|municipality|island|archipelago|subdistrict)$/;
const KIND_WORD: Partial<Record<PlaceKind, string>> = { city: "a city", town: "a town", village: "a village", locality: "a part of a town", subdistrict: "a mandal or tehsil", district: "a district", state: "a state" };
/** A town this big counts as a city (the same line as lib/engine/settlement.ts). */
export const CITY_MIN_POP = 300_000;

const site = (hours: HoursFit, confidence: RoleConfidence, reasons: string[]): RoleAnswer => ({ role: "site", confidence, hours, reasons });

/** The role of one place, with the evidence that decided it. */
export function placeRole(e: RoleEvidence): RoleAnswer {
  const t = e.osmTags ?? null;
  // 1. A map answer that says outright it is a settlement or an area.
  if (t?.place && SETTLEMENT_PLACE.test(t.place)) return { role: "settlement", confidence: "high", hours: "not_applicable", reasons: [`The map lists it as a ${t.place.replace(/_/g, " ")}`] };
  if ((t?.place && AREA_PLACE.test(t.place)) || t?.boundary === "administrative" || t?.natural === "valley") {
    return { role: "area", confidence: "high", hours: "not_applicable", reasons: [t?.place ? `The map lists it as a ${t.place}` : t?.natural === "valley" ? "The map lists it as a valley" : "The map lists it as an administrative area"] };
  }
  // 2. Our India index: towns and areas are only ever towns and areas there.
  const k = e.kind ?? null;
  if (k === "city" || k === "town" || k === "village" || k === "locality") {
    const pop = e.population ?? 0;
    const word = k === "town" && pop >= CITY_MIN_POP ? "a city" : KIND_WORD[k]!;
    const reasons = [`It is ${word}${pop > 0 ? ` (about ${pop.toLocaleString("en-IN")} people)` : ""}`];
    return { role: "settlement", confidence: k === "locality" || (k === "village" && pop === 0) ? "medium" : "high", hours: "not_applicable", reasons };
  }
  if (k === "subdistrict" || k === "district" || k === "state") return { role: "area", confidence: "high", hours: "not_applicable", reasons: [`It is ${KIND_WORD[k]}`] };
  // 3. What the catalogue knows it as: the Wikidata type first (the most specific), then the map's tag, then the kind.
  const parts = e.parts && e.parts.count >= 2 ? e.parts : null;
  const asSite = (hours: HoursFit, confidence: RoleConfidence, why: string): RoleAnswer =>
    parts && hours !== "open_access_likely"
      ? { role: "complex", confidence: parts.by === "wikidata" ? confidence : lower(confidence), hours: "per_part", reasons: [why, `${parts.count} places ${parts.by === "wikidata" ? "are listed as part of it" : "inside it carry its name"}`] }
      : site(hours, confidence, [why]);
  if (e.wdType && AREA_WD_TYPES[e.wdType]) return { role: "area", confidence: "high", hours: "not_applicable", reasons: [`Wikidata lists it as ${AREA_WD_TYPES[e.wdType]}`] };
  if (e.osmType && AREA_OSM.test(e.osmType)) return { role: "area", confidence: "high", hours: "not_applicable", reasons: [`The map tags it ${e.osmType}`] };
  if (e.wdType && OPEN_WD_TYPES[e.wdType]) return asSite("open_access_likely", "high", `Wikidata lists it as ${OPEN_WD_TYPES[e.wdType]}`);
  if (e.osmType && OPEN_OSM.test(e.osmType)) return asSite("open_access_likely", "high", `The map tags it ${e.osmType}`);
  if (e.category) {
    const wdLabel = e.wdType ? ROOTS.find((r) => r.qid === e.wdType)?.label : undefined;
    const evidence = wdLabel ? `Wikidata lists it as: ${wdLabel}` : e.osmType ? `The map tags it ${e.osmType}` : `Our place catalogue lists it under ${e.category}`;
    return asSite(OPEN_CATEGORIES.has(e.category) ? "open_access_likely" : "applicable", wdLabel || e.osmType ? "high" : "medium", evidence);
  }
  // 4. A map tag shape the catalogue would keep, seen in a live answer.
  if (t && (t.historic || t.tourism || t.amenity === "place_of_worship" || t.natural || t.leisure)) {
    const open = (t.natural && /^(beach|peak|water|hill)$/.test(t.natural)) || t.tourism === "viewpoint";
    return asSite(open ? "open_access_likely" : "applicable", "medium", "The map tags it as a place to visit");
  }
  // 5. Only a broad kind from our index: a sight or a stretch of water, coast, park or hill. Real, but thin.
  if (k === "sight" || k === "park") return site("applicable", "medium", ["Our India index lists it as a sight"]);
  if (k === "water" || k === "coast" || k === "hill") return site("open_access_likely", "medium", [`Our India index lists it as ${k === "water" ? "water" : k === "coast" ? "coast" : "a hill"}`]);
  if (k === "station" || k === "airport") return { role: "unknown", confidence: "medium", hours: "unknown", reasons: [`It is ${k === "station" ? "a station" : "an airport"}, not a place to visit`] };
  return { role: "unknown", confidence: "low", hours: "unknown", reasons: ["We don't know what kind of place it is"] };
}

const lower = (c: RoleConfidence): RoleConfidence => (c === "high" ? "medium" : "low");

/** A settlement or an area never has "missing" hours: it has none to miss. */
export const hasNoOwnHours = (r: Pick<RoleAnswer, "role">) => r.role === "settlement" || r.role === "area";
