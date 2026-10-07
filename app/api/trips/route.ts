import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { createTripSchema } from "@/lib/validation/schemas";

// Create a trip. The owner is added as the first member by the `on_trip_created`
// database trigger, so the two writes are atomic.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, createTripSchema);
  if (bodyError) return bodyError;

  const { data: trip, error } = await supabase
    .from("trips")
    .insert({ ...input, owner_id: user.id })
    .select()
    .single();

  if (error) return dbError(error, "create trip");
  return NextResponse.json(trip, { status: 201 });
}
