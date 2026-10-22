// "Where am I?" for the start field: a readable name for the phone's position ("Madhapur, Hyderabad").
// Our own index answers almost everywhere, free and instantly. Only when it can say no more than "Near Jangaon" do we ask Nominatim for
// the village or area — counted against the visitor's daily limit, and cached per ~1 km square so neighbours and repeat visits are free.
// The position is never stored; Nominatim only ever sees it rounded to about 1 km.
import { AsyncCache } from "@/lib/cache";
import type { ReverseDetail } from "@/lib/geocode";
import { describeHere, type GeoIndex } from "./geo-index";
import { inIndiaBox, type PlaceSource } from "./types";

export type HereAnswer =
  | { found: true; name: string; area: string; approximate: boolean; source: PlaceSource }
  | { found: false; reason: "outside_india" | "unknown" };

export type HereDeps = {
  index: () => Promise<GeoIndex | null>;
  reverse: (lat: number, lng: number) => Promise<ReverseDetail | null>;
  allow: () => Promise<boolean>;
};

const DAY_MS = 24 * 3_600_000;
export const hereCache = new AsyncCache<ReverseDetail | null>({ name: "place-here", max: 2000, ttlMs: (v) => (v ? 7 * DAY_MS : 10 * 60_000) });
export const hereKey = (lat: number, lng: number) => `${(Math.round(lat * 100) / 100).toFixed(2)},${(Math.round(lng * 100) / 100).toFixed(2)}`;

export async function nameHere(lat: number, lng: number, deps: HereDeps): Promise<HereAnswer> {
  if (!inIndiaBox(lat, lng)) return { found: false, reason: "outside_india" };
  const ix = await deps.index();
  const local = ix ? describeHere(ix, lat, lng) : null;
  if (local && !local.approximate) return { found: true, name: local.name, area: local.area, approximate: false, source: "geonames" };

  const key = hereKey(lat, lng);
  let remote = hereCache.peek(key);
  if (remote === undefined && (await deps.allow())) {
    try { remote = await hereCache.get(key, () => deps.reverse(lat, lng)); } catch { remote = undefined; }
  }
  if (remote) return { found: true, name: remote.name, area: remote.area, approximate: false, source: "osm" };
  if (local) return { found: true, name: local.name, area: local.area, approximate: true, source: "geonames" };
  return { found: false, reason: "unknown" };
}
