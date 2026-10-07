import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { uuid, voteSchema } from "@/lib/validation/schemas";

// Cast, change, or clear (vote: 0) your vote on a place. One vote per member per place.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid place id", 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, voteSchema);
  if (bodyError) return bodyError;

  const { data: place, error: findError } = await supabase.from("places").select("id, trip_id").eq("id", id).maybeSingle();
  if (findError) return dbError(findError, "vote: find place");
  if (!place) return jsonError("Place not found", 404);

  if (input.vote === 0) {
    const { error } = await supabase.from("place_votes").delete().eq("place_id", id).eq("user_id", user.id);
    if (error) return dbError(error, "vote: clear");
  } else {
    const { error } = await supabase
      .from("place_votes")
      .upsert({ trip_id: place.trip_id, place_id: id, user_id: user.id, vote: input.vote }, { onConflict: "place_id,user_id" });
    if (error) return dbError(error, "vote: save");
  }
  return NextResponse.json({ ok: true });
}
