import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { searchNearbyDetailed, type NearbyPlace } from "@/lib/nearby";
import { getPoiService } from "@/lib/poi";
import { runBackground } from "@/lib/poi/background";
import { nearbyFromOwnData } from "@/lib/poi/near";
import { attachPhotos, attachResolvedPhotos, COMMONS_KINDS, fetchCommonsImages } from "@/lib/nearby-photos";
import { lookupPlacePhotos } from "@/lib/place-photos";
import { consumeQuota } from "@/lib/quota";
import { nearbySchema } from "@/lib/validation/schemas";

export const maxDuration = 25;

/** At most this many sights get a Wikipedia lookup per search, and the search waits at most this long for them. */
const PHOTO_LOOKUPS = 12;
const PHOTO_BUDGET_MS = 6_000;
/** The value if it arrives within `ms`, otherwise null (the work itself keeps going and fills the cache). */
const settleWithin = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  new Promise((resolve) => { const t = setTimeout(() => resolve(null), ms); p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); }); });

// Real places around a point (OpenStreetMap) with REAL photos where they exist.
// The point is used for this request only and is not stored.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, nearbySchema);
  if (bodyError) return bodyError;

  // Following your location re-searches as you move, so this is generous. Results are cached for 10 minutes.
  if (!(await consumeQuota(supabase, "nearby", 400))) {
    return jsonError("You've used today's nearby searches. Please try again tomorrow.", 429);
  }

  const origin = { lat: input.lat, lng: input.lng };
  let places: NearbyPlace[] = [];
  let stale = false;
  let source: "own" | "live" = "own";

  // 1) Our own places database (filled tile by tile) — fast, and costs no public server a request.
  let own: Awaited<ReturnType<typeof nearbyFromOwnData>> | null = null;
  try {
    own = await nearbyFromOwnData(getPoiService(), input.kind, origin, input.radius_km);
    if (own.pending.length > 0) {
      const run = () => runBackground(own!.pending);
      try { after(run); } catch { void run(); } // outside a request scope (tests) just run it
    }
  } catch (e) {
    console.error("[api] nearby (own data):", e instanceof Error ? e.message : e);
  }

  if (own && own.complete && own.places.length > 0) {
    places = own.places;
  } else {
    // 2) Our data for this area is still being built (or empty): ask the live map server, which has its own cache and fallbacks.
    try {
      ({ places, stale } = await searchNearbyDetailed(input.kind, origin, input.radius_km));
      source = "live";
    } catch (e) {
      console.error("[api] nearby (live):", e instanceof Error ? e.message : e);
      // 3) Last resort: whatever part of our own data we already have beats an error.
      if (own && own.places.length > 0) places = own.places;
      else return jsonError("Nearby search is busy right now. Please try again in a minute.", 502);
    }
  }

  // Photo enrichment is best-effort: it can only ADD pictures, never break the search.
  // A place's photo is its own (OSM/Wikimedia tag) or, for sights only, a Commons photo of that spot. Traveler uploads are
  // destination media and are never used as a place's picture.
  try {
    if (places.length > 0 && COMMONS_KINDS.includes(input.kind)) {
      const commons = await fetchCommonsImages(origin, input.radius_km);
      places = attachPhotos(places, { commons });
    }
  } catch (e) {
    console.error("[api] nearby photos:", e instanceof Error ? e.message : e);
  }

  // Well-known sights: find their Wikipedia article and its best free photo (cache first). Waits a few seconds at most; anything not
  // finished in time is cached when it completes, so the next search shows it.
  if (input.kind === "sights") {
    try {
      const missing = places.filter((p) => !p.photo).slice(0, PHOTO_LOOKUPS);
      if (missing.length > 0) {
        const found = await settleWithin(
          lookupPlacePhotos(missing.map((p) => ({ key: p.id, name: p.name, lat: p.lat, lng: p.lng })), { allowUpstream: () => consumeQuota(supabase, "place_photos", 300) }),
          PHOTO_BUDGET_MS,
        );
        if (found) places = attachResolvedPhotos(places, found.photos);
      }
    } catch (e) {
      console.error("[api] nearby resolved photos:", e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ places, stale, source });
}
