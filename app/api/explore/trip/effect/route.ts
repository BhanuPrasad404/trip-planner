import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { exploreEffectSchema } from "@/lib/validation/schemas";
import { previewAddStop } from "@/lib/server/explore-effect";

// Read-only: "what would adding this stop do to that day?" The trip is read with the person's own access (not a member = not found).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`explore-effect:${user.id}`, 30, 60_000)) return jsonError("Slow down a little", 429);
  const { data: input, error: bodyError } = await parseBody(req, exploreEffectSchema);
  if (bodyError) return bodyError;
  try {
    const a = await previewAddStop(supabase, { tripId: input.trip_id, day: input.day_number, place: input.place });
    if ("error" in a) return jsonError("Trip not found", 404);
    return NextResponse.json(a, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[api] explore/trip/effect:", e instanceof Error ? e.message : e);
    return jsonError("We couldn't work that out right now. Please try again.", 500);
  }
}
