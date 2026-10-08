// Real photos for nearby places. Sources, in order of trust:
//   1. osm        — the place's own OpenStreetMap photo tag (already on the place, Wikimedia only)
//   2. commons    — geotagged Wikimedia Commons photos within ~300 m, for SIGHTS only
// Traveler/community uploads are deliberately NOT a source: a photo taken near a place is destination media, not a picture of
// that place (a waterfall photo must never become a pharmacy's picture).
// A place with no real photo gets none. We never show stock or look-alike pictures.
import { distanceKm, type GeoPoint } from "@/lib/geo";
import type { NearbyKind, NearbyPhoto, NearbyPlace } from "@/lib/nearby";

export type CommonsImage = { lat: number; lng: number; thumb: string; pageUrl: string };

export const COMMONS_PHOTO_KM = 0.3;

/** Commons is only used where a geotagged photo is very likely to be of the place itself. */
export const COMMONS_KINDS: NearbyKind[] = ["sights"];

type CommonsPage = {
  title?: string;
  coordinates?: { lat: number; lon: number }[];
  imageinfo?: { thumburl?: string; descriptionurl?: string }[];
};

export function parseCommons(json: unknown): CommonsImage[] {
  const pages = (json as { query?: { pages?: Record<string, CommonsPage> } } | null)?.query?.pages;
  if (!pages || typeof pages !== "object") return [];
  const out: CommonsImage[] = [];
  for (const p of Object.values(pages)) {
    const c = p.coordinates?.[0];
    const info = p.imageinfo?.[0];
    if (!c || !info?.thumburl || !info.descriptionurl) continue;
    try {
      const thumb = new URL(info.thumburl);
      const page = new URL(info.descriptionurl);
      if (thumb.protocol !== "https:" || thumb.hostname !== "upload.wikimedia.org") continue;
      if (page.protocol !== "https:" || page.hostname !== "commons.wikimedia.org") continue;
      if (!/\.(jpe?g|png|webp)(\?|$)/i.test(thumb.pathname + thumb.search)) continue; // skip svg/pdf/video
      out.push({ lat: c.lat, lng: c.lon, thumb: thumb.toString(), pageUrl: page.toString() });
    } catch {
      /* malformed URL — skip */
    }
  }
  return out;
}

const cache = new Map<string, { at: number; images: CommonsImage[] }>();
const TTL_MS = 30 * 60_000;
export const clearCommonsCache = () => cache.clear();

/** One geosearch around the point. Best-effort: any failure just means no Commons photos. */
export async function fetchCommonsImages(origin: GeoPoint, radiusKm: number, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<CommonsImage[]> {
  const radiusM = Math.min(10_000, Math.max(100, Math.round(radiusKm * 1000)));
  const key = `${origin.lat.toFixed(2)},${origin.lng.toFixed(2)}:${radiusM}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < TTL_MS) return hit.images;

  const params = new URLSearchParams({
    action: "query", format: "json", generator: "geosearch", ggsnamespace: "6", ggslimit: "50",
    ggscoord: `${origin.lat.toFixed(5)}|${origin.lng.toFixed(5)}`, ggsradius: String(radiusM),
    prop: "imageinfo|coordinates", iiprop: "url", iiurlwidth: "320", colimit: "50",
  });
  try {
    const res = await fetchImpl(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { "User-Agent": process.env.GEOCODER_USER_AGENT || "Trailmate/0.1 (trip planner)" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];
    const images = parseCommons(await res.json());
    if (cache.size >= 100) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: now(), images });
    return images;
  } catch {
    return [];
  }
}

const nearest = <T extends GeoPoint>(to: GeoPoint, items: T[], maxKm: number): T | null => {
  let best: T | null = null;
  let bestKm = maxKm;
  for (const it of items) {
    const km = distanceKm(to, it);
    if (km <= bestKm) { best = it; bestKm = km; }
  }
  return best;
};

export function attachPhotos(places: NearbyPlace[], sources: { commons?: CommonsImage[] }): NearbyPlace[] {
  return places.map((p) => {
    if (p.photo) return p; // the place's own OSM photo
    if (COMMONS_KINDS.includes(p.kind)) {
      const w = nearest(p, sources.commons ?? [], COMMONS_PHOTO_KM);
      if (w) return { ...p, photo: { url: w.thumb, source: "commons", creditUrl: w.pageUrl } satisfies NearbyPhoto };
    }
    return p;
  });
}
