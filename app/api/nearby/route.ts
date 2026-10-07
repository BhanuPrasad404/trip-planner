import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { searchNearbyDetailed, type NearbyPlace } from "@/lib/nearby";
import { getPoiService } from "@/lib/poi";
import { runBackground } from "@/lib/poi/background";
import { nearbyFromOwnData } from "@/lib/poi/near";
import { attachPhotos, COMMONS_KINDS, fetchCommonsImages, type CommunityPhoto } from "@/lib/nearby-photos";
import { consumeQuota } from "@/lib/quota";
import { REPORT_PHOTO_BUCKET } from "@/lib/reports";
import { nearbySchema } from "@/lib/validation/schemas";

export const maxDuration = 25;

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
  try {
    if (places.length > 0) {
      const pad = 0.004; // ~450 m
      const lats = places.map((p) => p.lat);
      const lngs = places.map((p) => p.lng);
      const since = new Date(Date.now() - 180 * 86_400_000).toISOString();
      const [reportsRes, commons] = await Promise.all([
        supabase
          .from("place_reports")
          .select("lat, lng, photo_path")
          .not("photo_path", "is", null)
          .gte("created_at", since)
          .gte("lat", Math.min(...lats) - pad)
          .lte("lat", Math.max(...lats) + pad)
          .gte("lng", Math.min(...lngs) - pad)
          .lte("lng", Math.max(...lngs) + pad)
          .order("created_at", { ascending: false })
          .limit(200),
        COMMONS_KINDS.includes(input.kind) ? fetchCommonsImages(origin, input.radius_km) : Promise.resolve([]),
      ]);
      const community: CommunityPhoto[] = (reportsRes.data ?? []).map((r: { lat: number; lng: number; photo_path: string }) => ({
        lat: r.lat,
        lng: r.lng,
        url: supabase.storage.from(REPORT_PHOTO_BUCKET).getPublicUrl(r.photo_path).data.publicUrl,
      }));
      places = attachPhotos(places, { community, commons });
    }
  } catch (e) {
    console.error("[api] nearby photos:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ places, stale, source });
}
