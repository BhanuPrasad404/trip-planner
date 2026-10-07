import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { normalizeCategory } from "@/lib/categories";
import { bulkPlacesSchema } from "@/lib/validation/schemas";

const MAX_PLACES_PER_TRIP = 200;

// Saves user-approved import candidates into the trip's "Ideas" pool (day_number = null).
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, bulkPlacesSchema);
  if (bodyError) return bodyError;

  const { count, error: countError } = await supabase
    .from("places")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", input.trip_id);
  if (countError) return dbError(countError, "bulk: count");
  if ((count ?? 0) + input.places.length > MAX_PLACES_PER_TRIP) {
    return jsonError(`A trip can have up to ${MAX_PLACES_PER_TRIP} places`, 400);
  }

  const { data: last } = await supabase
    .from("places")
    .select("sequence_order")
    .eq("trip_id", input.trip_id)
    .is("day_number", null)
    .order("sequence_order", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  let seq = last?.sequence_order ?? 0;

  const rows = input.places.map((p) => ({
    trip_id: input.trip_id,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    category: p.category ? normalizeCategory(p.category) : null,
    source_type: p.source_type,
    source_url: p.source_url,
    season_tag_id: p.season_tag_id,
    notes: p.notes,
    address: p.address,
    day_number: null,
    sequence_order: ++seq,
    added_by: user.id,
  }));

  const { data, error } = await supabase.from("places").insert(rows).select("id");
  if (error) return dbError(error, "bulk: insert");
  return NextResponse.json({ added: data?.length ?? 0 }, { status: 201 });
}
