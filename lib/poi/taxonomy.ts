// Turns a provider's raw tags into OUR place kinds. Everything downstream (ranking, Smart Stops, UI) only knows these kinds.
import type { RawPlace } from "@/lib/providers/types";
import type { PoiKind, PoiRecord } from "./types";

export function classify(tags: Record<string, string>): PoiKind | null {
  const a = tags.amenity;
  switch (a) {
    case "fuel": return "fuel";
    case "charging_station": return "ev";
    case "restaurant": case "fast_food": case "food_court": return "food";
    case "cafe": return "cafe";
    case "toilets": return "restroom";
    case "pharmacy": return "pharmacy";
    case "hospital": case "clinic": return "hospital";
    case "atm": case "bank": return "atm";
    case "car_repair": return "repair";
    case "parking": return tags.access && /^(private|customers|permit)$/.test(tags.access) ? null : "parking";
  }
  if (tags.shop === "car_repair") return "repair";
  if (/^(hotel|guest_house|hostel|resort|motel)$/.test(tags.tourism ?? "")) return "stay";
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (/^(attraction|museum|zoo|theme_park|gallery)$/.test(tags.tourism ?? "")) return "sight";
  if (/^(fort|castle|monument|temple|archaeological_site|ruins)$/.test(tags.historic ?? "")) return "sight";
  if (tags.natural === "waterfall") return "sight";
  // Most Indian temples (and mosques, churches, gurdwaras) are tagged only as a place of worship. Keep one when somebody found it notable
  // or it carries hours data, so the hours can be found; not every roadside shrine.
  if (tags.amenity === "place_of_worship" && (worshipNotable(tags) || HOURS_TAGS.some((k) => !!tags[k]))) return "sight";
  return null;
}
const worshipNotable = (t: Record<string, string>) => !!(t.wikidata || t.wikipedia || t.heritage || t.tourism === "attraction" || t.historic);
/** Tags that say something about when a place can be visited. */
export const HOURS_TAGS = ["opening_hours", "service_times", "opening_hours:url"] as const;

// Only the tags we actually use are stored — keeps the table small and avoids hoarding personal details (e.g. phone numbers of individuals).
// Hours: the schedule, service (darshan / prayer) times, the page the hours come from, the date a mapper last checked them, the website.
const KEEP = ["brand", "operator", "opening_hours", "cuisine", "diet:vegetarian", "diet:vegan", "wikimedia_commons", "wikidata", "wikipedia", "heritage", "image", "fee", "wheelchair", "fuel:diesel", "website",
  "service_times", "opening_hours:url", "check_date", "check_date:opening_hours", "contact:website",
  // Other names of the same place, so "Golden Temple" can find a place mapped under its other name.
  "alt_name", "old_name", "official_name", "name:en"];
const clip = (v: string) => v.trim().slice(0, 200);

export function toRecord(raw: RawPlace, source: string, fetchedAt: string): PoiRecord | null {
  const kind = classify(raw.tags);
  if (!kind) return null;
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lng) || Math.abs(raw.lat) > 90 || Math.abs(raw.lng) > 180) return null;
  const name = (raw.tags.name || "").trim().slice(0, 120) || null;
  // An unnamed sight/stay/viewpoint can't be recommended to anyone.
  if (!name && (kind === "sight" || kind === "viewpoint" || kind === "stay")) return null;
  const tags: Record<string, string> = {};
  for (const k of KEEP) if (raw.tags[k]) tags[k] = clip(raw.tags[k]);
  return { source, source_id: raw.id, kind, name, lat: raw.lat, lng: raw.lng, tags, fetched_at: fetchedAt };
}
