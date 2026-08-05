import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Create a new trip + add the creator as the first trip_member
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, start_city, start_lat, start_lng, start_date, num_days } = body;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: trip, error } = await supabase
    .from("trips")
    .insert({ owner_id: user.id, name, start_city, start_lat, start_lng, start_date, num_days })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("trip_members").insert({
    trip_id: trip.id,
    user_id: user.id,
    display_name: user.email?.split("@")[0] ?? "You",
  });

  return NextResponse.json(trip);
}
