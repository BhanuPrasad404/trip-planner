// Travel Radar POI media — what a SPECIFIC place looks like.
//
// Three kinds of media exist in Trailmate and they must never stand in for each other:
//   1. Profile media            — who a person is (avatar, cover).
//   2. Destination / community  — what a DESTINATION looks like (traveler photos & videos, report photos on a stop).
//   3. POI media (this file)    — what ONE Radar place (a restaurant, a pump, a hotel…) looks like.
//
// A POI may only show a photo that belongs to that POI itself: the Wikimedia photo its own OpenStreetMap entry points to.
// A traveler's upload that merely happens to be geographically close (a waterfall photo taken 200 m from a dhaba) is NOT
// a photo of the dhaba and is never used here. No legitimate photo → no photo; the UI shows the category icon instead.
import { osmPhoto, type NearbyPhoto } from "@/lib/nearby";

export type PoiPhoto = Omit<NearbyPhoto, "source"> & { source: "osm" };

/** The POI's own photo, taken only from its own stored tags — never from nearby traveler content. */
export function poiOwnPhoto(poi: { tags?: Record<string, string> | null }): PoiPhoto | null {
  const p = poi.tags ? osmPhoto(poi.tags) : null;
  return p ? { ...p, source: "osm" } : null;
}
