import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { insertStopSchema, uuid } from "@/lib/validation/schemas";

const MAX_PLACES_PER_TRIP = 200;

// "Go there": add a suggested place as the NEXT stop of a day. Nothing else is deleted; the response lists
// exactly what changed so the client can offer a precise Undo (see /restore).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, insertStopSchema);
  if (bodyError) return bodyError;

  const { data: trip, error: tripError } = await supabase.from("trips").select("id, num_days").eq("id", id).maybeSingle();
  if (tripError) return dbError(tripError, "insert-stop: load trip");
  if (!trip) return jsonError("Trip not found", 404);
  if (input.day_number > trip.num_days) return jsonError("That day is outside this trip", 400);

  const { data: all, error: listError } = await supabase.from("places").select("id, name, lat, lng, day_number, sequence_order, status").eq("trip_id", id);
  if (listError) return dbError(listError, "insert-stop: list");
  const places = all ?? [];
  if (places.length >= MAX_PLACES_PER_TRIP) return jsonError(`A trip can have up to ${MAX_PLACES_PER_TRIP} places.`, 422);

  const today = places.filter((p) => p.day_number === input.day_number);
  const finished = today.filter((p) => p.status === "done" || p.status === "skipped");
  const base = Math.max(0, ...finished.map((p) => p.sequence_order ?? 0)); // the new stop comes right after what is already behind you
  const after = today.filter((p) => (p.status ?? "planned") === "planned"); // everything still ahead moves one place later

  const { data: created, error } = await supabase
    .from("places")
    .insert({
      trip_id: id, name: input.name, lat: input.lat, lng: input.lng, category: input.category, address: input.address,
      notes: input.notes, source_type: "manual", day_number: input.day_number, sequence_order: base + 1,
      added_by: user.id,
    })
    .select("id")
    .single();
  if (error) return dbError(error, "insert-stop: insert");

  // Push the rest of the day one place later. Their arrival times were computed without this stop, so clear them
  // (the day shows "--:--" until Re-plan) rather than leave times that are now wrong.
  const shifted = after.map((p) => ({
    id: p.id, trip_id: id, name: p.name, lat: p.lat, lng: p.lng,
    sequence_order: (p.sequence_order ?? base) + 1, arrival_time: null, drive_minutes: null, drive_km: null,
  }));
  if (shifted.length > 0) {
    const { error: shiftError } = await supabase.from("places").upsert(shifted, { onConflict: "id" });
    if (shiftError) {
      await supabase.from("places").delete().eq("id", created.id); // don't leave half a change behind
      return dbError(shiftError, "insert-stop: shift");
    }
  }
  return NextResponse.json({ ok: true, id: created.id, shifted: shifted.length, needsReplan: shifted.length > 0 }, { status: 201 });
}
