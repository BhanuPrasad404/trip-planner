import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { tripPrefsSchema, uuid } from "@/lib/validation/schemas";

// Trip type + vehicle range: they tune what Trip Intelligence recommends. Only the owner can change them (enforced by RLS).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, tripPrefsSchema);
  if (bodyError) return bodyError;

  const { data, error } = await supabase.from("trips").update({ trip_type: input.trip_type, vehicle_range_km: input.vehicle_range_km }).eq("id", id).select("id");
  if (error) return dbError(error, "trip prefs: update");
  if (!data || data.length === 0) return jsonError("Only the trip owner can change these settings", 403);
  return NextResponse.json({ ok: true });
}
