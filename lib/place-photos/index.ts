// Real photos of PLACES (a temple, a fort, a waterfall) from Wikipedia's lead image for that very place.
// Not traveler uploads, not stock, not "something nearby": see match.ts for the identity rule. Best-effort — never throws.
import type { GeoPoint } from "@/lib/geo";
import { pickPage, type PageCandidate } from "./match";

export type PlacePhoto = { url: string; width: number; height: number; title: string; /** Where to see and credit the original. */ pageUrl: string; source: "wikipedia" };
export type PlacePhotoQuery = { key: string; name: string } & GeoPoint;

type WikiPage = { title?: string; coordinates?: { lat: number; lon: number }[]; thumbnail?: { source?: string; width?: number; height?: number } };

export function parseGeosearch(json: unknown): PageCandidate[] {
  const pages = (json as { query?: { pages?: WikiPage[] | Record<string, WikiPage> } } | null)?.query?.pages;
  if (!pages || typeof pages !== "object") return [];
  const out: PageCandidate[] = [];
  for (const p of Array.isArray(pages) ? pages : Object.values(pages)) {
    const c = p.coordinates?.[0];
    if (!p.title || !c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    let thumb: PageCandidate["thumb"] = null;
    const t = p.thumbnail;
    if (t?.source && t.width && t.height) {
      try {
        const u = new URL(t.source);
        if (u.protocol === "https:" && u.hostname === "upload.wikimedia.org" && /\.(jpe?g|png|webp)(\?|$)/i.test(u.pathname) && !/\.svg/i.test(u.pathname)) {
          thumb = { url: u.toString(), width: t.width, height: t.height };
        }
      } catch { /* malformed URL: no photo */ }
    }
    out.push({ title: p.title, lat: c.lat, lng: c.lon, thumb });
  }
  return out;
}

const cache = new Map<string, { at: number; pages: PageCandidate[] }>();
/** Lookups already on their way, so two places in the same spot share one request instead of racing. */
const inflight = new Map<string, Promise<PageCandidate[] | null>>();
const TTL_MS = 24 * 3_600_000;
export const clearPlacePhotoCache = () => cache.clear();

/** One geosearch per ~100 m cell, shared by every place in that cell. Failures are not cached. */
function pagesNear(p: GeoPoint, fetchImpl: typeof fetch, now: () => number): Promise<PageCandidate[] | null> {
  const key = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < TTL_MS) return Promise.resolve(hit.pages);
  const running = inflight.get(key);
  if (running) return running;
  const job = fetchPagesNear(p, key, fetchImpl, now).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function fetchPagesNear(p: GeoPoint, key: string, fetchImpl: typeof fetch, now: () => number): Promise<PageCandidate[] | null> {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", generator: "geosearch", ggsnamespace: "0", ggslimit: "15",
    ggscoord: `${p.lat.toFixed(5)}|${p.lng.toFixed(5)}`, ggsradius: "3000",
    prop: "coordinates|pageimages", piprop: "thumbnail", pithumbsize: "480", pilimit: "15", colimit: "15",
  });
  try {
    const res = await fetchImpl(`https://en.wikipedia.org/w/api.php?${params}`, {
      headers: { "User-Agent": process.env.GEOCODER_USER_AGENT || "Trailmate/0.1 (trip planner)" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const pages = parseGeosearch(await res.json());
    if (cache.size >= 500) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: now(), pages });
    return pages;
  } catch {
    return null;
  }
}

/** key → photo, only for places we are sure about. Places without a confident match are simply absent. */
export async function findPlacePhotos(places: PlacePhotoQuery[], fetchImpl: typeof fetch = fetch, now: () => number = Date.now, concurrency = 4): Promise<Record<string, PlacePhoto>> {
  const out: Record<string, PlacePhoto> = {};
  let next = 0;
  async function worker() {
    while (next < places.length) {
      const p = places[next++];
      const pages = await pagesNear(p, fetchImpl, now);
      const page = pages ? pickPage(p, pages) : null;
      if (page?.thumb) {
        out[p.key] = {
          url: page.thumb.url, width: page.thumb.width, height: page.thumb.height, title: page.title, source: "wikipedia",
          pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, places.length) }, worker));
  return out;
}
