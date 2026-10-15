import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { tripLifecycleSchema, uuid } from "@/lib/validation/schemas";

/**
 * The owner's decisions about what REALLY happened to a trip: resume it, finish it, call it off, or reopen it.
 *
 * It writes only the lifecycle columns. The planned dates, the stops and their progress, navigation and memories are never touched
 * here, so nothing can be lost or wrongly marked visited by this route. Owner only (a member can see the status, not change it).
 * Until migration 20261021000000 is applied the columns do not exist: that is reported plainly, not as a generic failure.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);

  const supabase = await createClient();
  const authP = supabase.auth.getUser();
  const tripP = Promise.resolve(supabase.from("trips").select("id, owner_id").eq("id", id).maybeSingle());
  const parsed = await parseBody(req, tripLifecycleSchema);
  const { data: { user } } = await authP;
  if (!user) return jsonError("Please sign in", 401);
  if (parsed.error) return parsed.error;

  const { data: trip, error: tripError } = await tripP;
  if (tripError) return dbError(tripError, "trip lifecycle: find");
  if (!trip) return jsonError("Trip not found", 404);
  if (trip.owner_id !== user.id) return jsonError("Only the trip owner can change this.", 403);

  const now = new Date().toISOString();
  const input = parsed.data;
  const patch =
    input.action === "resume" ? { resumed_at: now, closed_at: null, closed_reason: null, resume_day_end_min: input.day_end_min ?? null }
    : input.action === "finish" ? { closed_at: now, closed_reason: "finished" }
    : input.action === "cancel" ? { closed_at: now, closed_reason: "cancelled" }
    : { closed_at: null, closed_reason: null };

  const { data: updated, error } = await supabase.from("trips").update(patch).eq("id", id).select("id");
  if (error) {
    // 42703 / PGRST204: the lifecycle columns are not in the database yet (migration not applied).
    if (error.code === "42703" || error.code === "PGRST204" || /column .* (does not exist|of relation)|schema cache/i.test(error.message ?? "")) {
      console.error("[api] trip lifecycle: columns missing (migration 20261021000000 not applied)");
      return jsonError("This needs a database update that hasn't been applied yet, so the trip can't be changed right now. Nothing was lost.", 503);
    }
    return dbError(error, "trip lifecycle: update");
  }
  if (!updated || updated.length === 0) return jsonError("Trip not found", 404);
  return NextResponse.json({ ok: true, action: input.action });
}
