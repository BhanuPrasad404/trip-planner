import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { matchSeasonTag } from "@/lib/season-match";
import { createPlaceSchema, uuid } from "@/lib/validation/schemas";

export async function GET(req: NextRequest) {
  const tripId = req.nextUrl.searchParams.get("tripId");
  if (!tripId || !uuid.safeParse(tripId).success) {
    return jsonError("A valid tripId is required", 400);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("places")
    .select("*, season_tags(good_months, reason)")
    .eq("trip_id", tripId)
    .order("day_number", { ascending: true })
    .order("sequence_order", { ascending: true });

  if (error) return dbError(error, "list places");
  return NextResponse.json(data);
}

// Add a stop to a trip: validates input, matches it to curated season data, and
// appends it to the end of the chosen day.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, createPlaceSchema);
  if (bodyError) return bodyError;

  // Match against curated season data: similar name AND geographically close (see lib/season-match).
  const { data: tags } = await supabase.from("season_tags").select("id, place_name, lat, lng, category, good_months, reason");
  const match = matchSeasonTag(input, tags ?? []);

  // Next position within the day.
  const { data: last } = await supabase
    .from("places")
    .select("sequence_order")
    .eq("trip_id", input.trip_id)
    .eq("day_number", input.day_number)
    .order("sequence_order", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const { data: place, error } = await supabase
    .from("places")
    .insert({
      trip_id: input.trip_id,
      name: input.name,
      lat: input.lat,
      lng: input.lng,
      source_type: input.source_url ? "reel_link" : "manual",
      source_url: input.source_url,
      season_tag_id: match?.id ?? null,
      category: match?.category ?? null,
      address: input.address,
      day_number: input.day_number,
      sequence_order: (last?.sequence_order ?? 0) + 1,
      arrival_time: input.arrival_time,
      added_by: user.id,
    })
    .select()
    .single();

  if (error) return dbError(error, "create place");
  return NextResponse.json(place, { status: 201 });
}
