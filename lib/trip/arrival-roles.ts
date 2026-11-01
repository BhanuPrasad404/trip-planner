// What KIND of place is each stop on a trip: a city, a town, or something we cannot say? Decided from data only (our India place index,
// GeoNames, with populations) by the same rule the planner uses (lib/engine/settlement.ts `settlementOf`): a stop is a town or city only
// when its NAME matches a town or city within a few km of its pin. A sight inside a city ("Charminar" in Hyderabad) is never mistaken
// for the city, and a place with no match stays unknown (null): arrival then treats it as the point it has always been, because no
// radius is ever guessed for a place we do not understand. Pure: the index lookup is passed in.
import { settlementOf, type Nearby } from "@/lib/engine/settlement";
import type { ArrivalRole } from "@/lib/trip/arrival";

export type RoleItem = { key: string; name: string; lat: number; lng: number; category: string | null };
export type RoleMap = Record<string, ArrivalRole | null>;

/**
 * Only an uncategorised ("other") place, or one with no category, can be a settlement: a temple, a fort or a hotel is what it says it is.
 * An administrative AREA (a district, a mandal, a valley) is left unknown: it can be tens of km across, so no honest radius exists.
 */
export function rolesFor(items: RoleItem[], find: (lat: number, lng: number) => Nearby[]): RoleMap {
  const out: RoleMap = {};
  for (const it of items) {
    const generic = it.category === null || it.category === "other";
    const s = generic ? settlementOf({ name: it.name, lat: it.lat, lng: it.lng, category: "other", visitMin: null }, find(it.lat, it.lng)) : null;
    out[it.key] = s?.role === "city" ? "city" : s?.role === "town" ? "town" : null;
  }
  return out;
}
