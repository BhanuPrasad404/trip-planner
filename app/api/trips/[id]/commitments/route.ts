import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { tableMissing } from "@/lib/server/journey-events";
import { commitmentCreateSchema, uuid } from "@/lib/validation/schemas";

const MAX_PER_TRIP = 100;
const COLUMNS = "id, trip_id, place_id, label, kind, constraint_class, day, earliest_min, latest_min, source, reference, notes, created_by, created_at";
const NOT_YET = "Bookings need a database update that hasn't been applied yet, so they can't be saved right now. Nothing was changed.";

/** The trip's bookings and time-bound activities, for everyone on the trip. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const { data, error } = await supabase.from("trip_commitments").select(COLUMNS).eq("trip_id", id).order("day", { ascending: true }).limit(MAX_PER_TRIP);
  if (error) return tableMissing(error) ? NextResponse.json({ ok: true, stored: false, commitments: [] }) : dbError(error, "commitments: list");
  return NextResponse.json({ ok: true, stored: true, commitments: data ?? [] });
}

/**
 * Add a booking. It is the traveller's own statement and says so: "confirmed" only when they say it is confirmed with the provider; otherwise
 * it is kept as their word and only warns. A saved place is never turned into a booking by anything but this.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const supabase = await createClient();
  const authP = supabase.auth.getUser();
  const parsed = await parseBody(req, commitmentCreateSchema);
  const { data: { user } } = await authP;
  if (!user) return jsonError("Please sign in", 401);
  if (parsed.error) return parsed.error;
  if (!rateLimiter.take(`trip-commitments:${user.id}`, 60, 60_000)) return jsonError("Too many requests. Please slow down and try again shortly.", 429);
  const i = parsed.data;

  const trip = await supabase.from("trips").select("id, num_days").eq("id", id).maybeSingle();
  if (trip.error) return dbError(trip.error, "commitments: trip");
  if (!trip.data) return jsonError("Trip not found", 404);
  if (i.day > (trip.data as { num_days: number }).num_days + 30) return jsonError("That day is far beyond the trip's length.", 422);
  if (i.place_id) {
    const place = await supabase.from("places").select("id").eq("id", i.place_id).eq("trip_id", id).maybeSingle();
    if (place.error) return dbError(place.error, "commitments: place");
    if (!place.data) return jsonError("That stop isn't on this trip.", 422);
  }
  const have = await supabase.from("trip_commitments").select("id").eq("trip_id", id).limit(MAX_PER_TRIP + 1);
  if (have.error) return tableMissing(have.error) ? jsonError(NOT_YET, 503) : dbError(have.error, "commitments: count");
  if ((have.data?.length ?? 0) >= MAX_PER_TRIP) return jsonError("This trip already has the most bookings it can hold.", 422);

  const row = {
    trip_id: id, place_id: i.place_id ?? null, label: i.label, kind: i.kind, constraint_class: i.constraint_class, day: i.day,
    earliest_min: i.earliest_min ?? null, latest_min: i.latest_min ?? null, source: i.confirmed ? "confirmed" : "user_entered",
    reference: i.reference || null, notes: i.notes || null, created_by: user.id,
  };
  const { data, error } = await supabase.from("trip_commitments").insert(row).select(COLUMNS).maybeSingle();
  if (error) return tableMissing(error) ? jsonError(NOT_YET, 503) : dbError(error, "commitments: add");
  return NextResponse.json({ ok: true, commitment: data ?? row }, { status: 201 });
}
