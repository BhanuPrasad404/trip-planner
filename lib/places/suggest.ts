// What the search box shows the moment it is tapped, before anything is typed (the browser adds "Use my current location", recent and
// saved places on top). Only real data, each group named for where it comes from, so nothing is called "popular" that we cannot show:
//   Shared by Trailmate travellers — destinations people posted about (signed-in visitors only: that table is not public)
//   Researched by Trailmate        — our curated season places
//   Big towns near you             — the largest towns around you by population (GeoNames); the largest cities of India without a position
import { distanceKm } from "@/lib/geo";
import { biggestNear, nearestTo, type GeoIndex } from "./geo-index";
import { inIndiaBox, type PlaceHit } from "./types";

export type SuggestGroup = { id: "shared" | "researched" | "towns"; title: string; places: PlaceHit[] };
export type SuggestDeps = {
  index: () => Promise<GeoIndex | null>;
  /** Destinations travellers posted about, or null when this visitor may not see them. */
  shared: () => Promise<{ id: string; name: string; lat: number; lng: number; posts: number }[] | null>;
  researched: () => Promise<{ id: string; name: string; lat: number; lng: number; category: string | null; region: string | null }[]>;
};

export const NEAR_KM = 300;
const PER_GROUP = 5;

export async function suggestPlaces(near: { lat: number; lng: number } | null, deps: SuggestDeps): Promise<SuggestGroup[]> {
  const here = near && inIndiaBox(near.lat, near.lng) ? near : null;
  const [ix, shared, researched] = await Promise.all([deps.index(), deps.shared().catch(() => null), deps.researched().catch(() => [])]);
  const areaAt = (lat: number, lng: number, fallback: string) => (ix ? nearestTo(ix, lat, lng, ["locality", "town", "city", "subdistrict"], 30, 1)[0]?.hit.area : null) || fallback;
  const close = <T extends { lat: number; lng: number }>(rows: T[]) => (here ? rows.filter((r) => distanceKm(here, r) <= NEAR_KM) : rows);
  const groups: SuggestGroup[] = [];

  const sharedNear = close(shared ?? []).sort((a, b) => b.posts - a.posts || a.name.localeCompare(b.name)).slice(0, PER_GROUP);
  if (sharedNear.length) groups.push({ id: "shared", title: "Shared by Trailmate travellers", places: sharedNear.map((d) => ({ id: `dest:${d.id}`, name: d.name, lat: d.lat, lng: d.lng, kind: "place", area: areaAt(d.lat, d.lng, ""), state: null, source: "trailmate" })) });

  const researchedNear = close(researched)
    .sort((a, b) => (here ? distanceKm(here, a) - distanceKm(here, b) : 0) || a.name.localeCompare(b.name))
    .slice(0, PER_GROUP);
  if (researchedNear.length) groups.push({ id: "researched", title: "Researched by Trailmate", places: researchedNear.map((t) => ({ id: `season:${t.id}`, name: t.name, lat: t.lat, lng: t.lng, kind: "sight", area: areaAt(t.lat, t.lng, t.region ?? ""), state: t.region, source: "trailmate" })) });

  if (ix) {
    const towns = here ? biggestNear(ix, here.lat, here.lng, 150, PER_GROUP) : nearestTo(ix, 22, 79, ["city"], 3000, 5000).sort((a, b) => b.pop - a.pop).slice(0, 8).map((x) => x.hit);
    if (towns.length) groups.push({ id: "towns", title: here ? "Big towns near you" : "Big cities of India", places: towns });
  }
  return groups;
}
