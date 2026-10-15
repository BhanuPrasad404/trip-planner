import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, parseBody } from "@/lib/api";
import { lookupPlacePhotos, upstreamStats } from "@/lib/place-photos";
import { consumeQuota } from "@/lib/quota";
import { placePhotosSchema } from "@/lib/validation/schemas";

export const maxDuration = 25;

// Real photos of the places themselves (Wikipedia, matched by name AND location, licence verified). Purely cosmetic: every failure just
// means "no photo yet", so this route never returns a server error for an upstream problem.
//
// Cache first: places already answered (found OR "no photo") cost nothing. The daily allowance is charged only when something really
// has to be looked up upstream, so scrolling back and forth through the same lists never uses it up.
//   photos      key → verified photo
//   unresolved  keys we could NOT settle (allowance used up, or Wikimedia unreachable). The client must not remember these as "no photo".
//   reasons     why a place has none — only when the request asks for diagnostics (debug: true)
//   trails      every step taken, in words (debug: true only). Debug requests ignore the cache, so every place has a trail.
//   upstream    health counters of the Wikimedia client (debug: true only): calls, failures, rate limits, breaker
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, placePhotosSchema);
  if (bodyError) return bodyError;

  const unique = [...new Map(input.places.map((p) => [p.key, p])).values()];
  const result = await lookupPlacePhotos(unique, { allowUpstream: () => consumeQuota(supabase, "place_photos", 300), fresh: input.debug === true }).catch((e) => {
    console.error("[place-photos]", e instanceof Error ? e.message : e);
    return null;
  });
  if (!result) return NextResponse.json({ photos: {}, unresolved: unique.map((p) => p.key) }, { headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json(
    { photos: result.photos, unresolved: result.unresolved, ...(input.debug ? { reasons: result.reasons, trails: result.trails, upstream: upstreamStats() } : {}) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
