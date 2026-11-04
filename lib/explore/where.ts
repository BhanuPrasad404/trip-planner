// "Where is this?" for an Explore place, in words: the town it is in or near, its district and its state. Worked out from the place's
// coordinates with our own place index, so it costs no network call and never invents anything: no match, no line.
import { whereIs, type GeoIndex } from "@/lib/places/geo-index";
import { normalizeName } from "@/lib/places/types";
import type { ExploreItem } from "./items";

/** "Araku Valley, Visakhapatnam district, Andhra Pradesh" or "12 km from Araku Valley, …". */
export function whereText(w: { place: string; km: number; district: string | null; state: string | null }): string {
  const sameDistrict = !!w.district && normalizeName(w.district) === normalizeName(w.place);
  const parts = [
    w.km <= 2.5 ? w.place : `${Math.round(w.km)} km from ${w.place}`,
    w.district && !sameDistrict ? `${w.district} district` : null,
    w.state,
  ].filter((p): p is string => !!p);
  return parts.join(", ");
}

/** The same items with `where` filled in where our index knows the area. */
export function attachWhere(items: ExploreItem[], ix: GeoIndex | null): ExploreItem[] {
  if (!ix) return items;
  return items.map((item) => {
    const w = whereIs(ix, item.lat, item.lng);
    return w ? { ...item, where: { text: whereText(w), place: w.place, district: w.district, state: w.state } } : item;
  });
}
