import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { getSupabaseEnv } from "@/lib/env";
import { deleteTrip } from "@/lib/server/trip-delete";
import { createAdminClient, hasAdminAccess } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { deleteTripSchema, updateTripSchema, uuid } from "@/lib/validation/schemas";

/**
 * Change a trip's start date and/or number of days (owner only).
 *
 * Making the trip SHORTER never deletes anything: stops that sat on days that no longer exist go back to Ideas (their day, order,
 * time and drive info are cleared; the places themselves are kept). Making it longer or moving the dates changes no stops.
 * The sign-in check overlaps with reading the trip, but nothing is written until the person is confirmed as the owner.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);

  const supabase = await createClient();
  const authP = supabase.auth.getUser();
  // Promise.resolve(...) STARTS the read now; a query builder is lazy and would otherwise wait until it is awaited.
  const tripP = Promise.resolve(supabase.from("trips").select("*").eq("id", id).maybeSingle());
  const parsed = await parseBody(req, updateTripSchema);
  const { data: { user } } = await authP;
  if (!user) return jsonError("Please sign in", 401);
  if (parsed.error) return parsed.error;

  const { data: trip, error: tripError } = await tripP;
  if (tripError) return dbError(tripError, "trip patch: find");
  if (!trip) return jsonError("Trip not found", 404);
  if (trip.owner_id !== user.id) return jsonError("Only the trip owner can change the dates.", 403);

  const input = parsed.data;
  let movedToIdeas = 0;
  if (input.num_days !== undefined && input.num_days < trip.num_days) {
    const { data, error } = await supabase
      .from("places")
      .update({ day_number: null, sequence_order: null, arrival_time: null, drive_minutes: null, drive_km: null })
      .eq("trip_id", id)
      .gt("day_number", input.num_days)
      .select("id");
    if (error) return dbError(error, "trip patch: move stops to ideas");
    movedToIdeas = data?.length ?? 0;
  }

  const patch = {
    ...(input.start_date !== undefined ? { start_date: input.start_date } : {}),
    ...(input.num_days !== undefined ? { num_days: input.num_days } : {}),
    // A start time belongs to the first day it was chosen for: a new date without a new time goes back to the usual start.
    // (Only touched when the trip has one, so this route keeps working before the start_time column is added.)
    ...(input.start_time !== undefined ? { start_time: input.start_time } : input.start_date !== undefined && (trip as { start_time?: string | null }).start_time ? { start_time: null } : {}),
  };
  const { data: updated, error } = await supabase.from("trips").update(patch).eq("id", id).select("id");
  if (error) return dbError(error, "trip patch: update");
  if (!updated || updated.length === 0) return jsonError("Trip not found", 404);
  return NextResponse.json({ ok: true, movedToIdeas });
}

/**
 * Permanently delete a trip (owner only) with its stops, votes, members, live locations and stored trip files.
 * The owner types the trip name to confirm. "Finish" and "Call it off" (the lifecycle route) remain the way to close a trip and keep it.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const parsed = await parseBody(req, deleteTripSchema);
  if (parsed.error) return parsed.error;

  const result = await deleteTrip({
    supabase,
    admin: hasAdminAccess() ? createAdminClient() : null,
    supabaseUrl: getSupabaseEnv().url,
    userId: user.id,
    tripId: id,
    confirmName: parsed.data.confirm_name,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json({ ok: true, filesRemoved: result.filesRemoved });
}
