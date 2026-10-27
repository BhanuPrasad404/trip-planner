import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { consumeQuota } from "@/lib/quota";
import { exploreTripSchema } from "@/lib/validation/schemas";
import { ExploreQuotaError, ExploreUnavailableError } from "@/lib/explore/service";
import { getExploreStore } from "@/lib/explore/store";
import { exploreForTrip } from "@/lib/server/explore-trip";

// A corridor query may have to ask the map servers (then it is shared for everyone on the same road), so it gets the same time as a region.
export const maxDuration = 60;

// Explore for ONE trip: places along its remaining road, or round where the traveller is staying. Read-only: nothing about the trip
// changes. The trip is read with the person's own access, so a trip that isn't theirs looks exactly like a trip that doesn't exist.
// Their position is used for this one answer and never stored.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`explore-trip:${user.id}`, 45, 60_000)) return jsonError("Slow down a little", 429);

  const { data: input, error: bodyError } = await parseBody(req, exploreTripSchema);
  if (bodyError) return bodyError;

  try {
    const answer = await exploreForTrip(
      supabase,
      { tripId: input.trip_id, category: input.category, radiusKm: input.radius_km, cursor: input.cursor, limit: input.limit, position: input.position },
      { loadDeps: { store: getExploreStore(), allowUpstream: () => consumeQuota(supabase, "explore", 150) } },
    );
    if ("error" in answer) return jsonError("Trip not found", 404);
    return NextResponse.json(answer, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof ExploreQuotaError) return jsonError("You've used today's place searches. Please try again tomorrow.", 429);
    console.error("[api] explore/trip:", e instanceof Error ? e.message : e);
    if (e instanceof ExploreUnavailableError) return jsonError("The map servers are busy right now. Please try again in a minute.", 502);
    return jsonError("Something went wrong. Please try again.", 500);
  }
}
