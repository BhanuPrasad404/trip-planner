import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { tableMissing } from "@/lib/server/journey-events";
import { commitmentPatchSchema, uuid } from "@/lib/validation/schemas";

const NOT_YET = "Bookings need a database update that hasn't been applied yet. Nothing was changed.";

/**
 * Change a booking. Only whoever entered it, or the trip's owner, may (Row Level Security: anyone else's change matches no row and is a
 * 404). Marking it confirmed or not is the traveller's statement and is kept as such.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(cid).success) return jsonError("Invalid id", 400);
  const supabase = await createClient();
  const authP = supabase.auth.getUser();
  const parsed = await parseBody(req, commitmentPatchSchema);
  const { data: { user } } = await authP;
  if (!user) return jsonError("Please sign in", 401);
  if (parsed.error) return parsed.error;
  if (!rateLimiter.take(`trip-commitments:${user.id}`, 60, 60_000)) return jsonError("Too many requests. Please slow down and try again shortly.", 429);
  const { confirmed, ...rest } = parsed.data;

  if (rest.place_id) {
    const place = await supabase.from("places").select("id").eq("id", rest.place_id).eq("trip_id", id).maybeSingle();
    if (place.error) return dbError(place.error, "commitments: place");
    if (!place.data) return jsonError("That stop isn't on this trip.", 422);
  }
  const patch: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() };
  if (confirmed !== undefined) patch.source = confirmed ? "confirmed" : "user_entered";
  if ("reference" in patch) patch.reference = (patch.reference as string | null | undefined) || null;
  if ("notes" in patch) patch.notes = (patch.notes as string | null | undefined) || null;

  // An edit may leave the window out of order (only one end sent): check against what is stored.
  if ("earliest_min" in rest || "latest_min" in rest) {
    const cur = await supabase.from("trip_commitments").select("earliest_min, latest_min").eq("id", cid).eq("trip_id", id).maybeSingle();
    if (cur.error) return tableMissing(cur.error) ? jsonError(NOT_YET, 503) : dbError(cur.error, "commitments: read");
    if (!cur.data) return jsonError("Booking not found", 404);
    const row = cur.data as { earliest_min: number | null; latest_min: number | null };
    const e = "earliest_min" in rest ? rest.earliest_min ?? null : row.earliest_min, l = "latest_min" in rest ? rest.latest_min ?? null : row.latest_min;
    if (e !== null && l !== null && e > l) return jsonError("The earliest time must be before the latest.", 422);
  }
  const { data, error } = await supabase.from("trip_commitments").update(patch).eq("id", cid).eq("trip_id", id).select("id");
  if (error) return tableMissing(error) ? jsonError(NOT_YET, 503) : dbError(error, "commitments: update");
  if (!data || data.length === 0) return jsonError("Booking not found", 404);
  return NextResponse.json({ ok: true });
}

/** Remove a booking you entered (or any, as the trip's owner). The stop it was on is untouched. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(cid).success) return jsonError("Invalid id", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const { data, error } = await supabase.from("trip_commitments").delete().eq("id", cid).eq("trip_id", id).select("id");
  if (error) return tableMissing(error) ? jsonError(NOT_YET, 503) : dbError(error, "commitments: remove");
  if (!data || data.length === 0) return jsonError("Booking not found", 404);
  return NextResponse.json({ ok: true });
}
