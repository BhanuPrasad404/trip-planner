import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { z } from "zod";
import { movePlaceSchema, placePrioritySchema, relocatePlaceSchema, stopStatusSchema, uuid } from "@/lib/validation/schemas";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid place id", 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  // RLS guarantees only trip members can delete; .select() tells us if anything matched.
  const { data, error } = await supabase.from("places").delete().eq("id", id).select("id");
  if (error) return dbError(error, "delete place");
  if (!data || data.length === 0) return jsonError("Place not found", 404);

  return NextResponse.json({ ok: true });
}

// STRICT on purpose: a request is EITHER a move OR a relocation. Mixed or unknown fields are rejected
// loudly instead of one half being silently dropped (and it blocks smuggling in columns like trip_id).
const patchSchema = z.union([movePlaceSchema.strict(), relocatePlaceSchema.strict(), stopStatusSchema.strict(), placePrioritySchema.strict()]);

// Either mark a stop done/skipped/planned (trip mode), move a stop to another day (day_number; null = back to Ideas),
// or relocate it when the pin is wrong (lat + lng, optionally a corrected name/address).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid place id", 400);

  const supabase = await createClient();
  // The sign-in check starts at once and overlaps with everything that does not depend on it (reading the body, looking the
  // place up). NOTHING is written until the Auth server has confirmed the person, exactly as before.
  const authP = supabase.auth.getUser();
  const parsed = await parseBody(req, patchSchema);
  const isMove = !parsed.error && !("priority" in parsed.data) && !("status" in parsed.data) && !("lat" in parsed.data);
  // Only a MOVE needs to know which trip the place belongs to; the other edits are a single UPDATE that tells us (through the
  // rows it changed) whether the place exists and is yours — a place you may not edit is invisible to you (Row Level Security).
  // Promise.resolve(...) STARTS the request now: a query builder is lazy and would otherwise wait until it is awaited.
  const findP = isMove ? Promise.resolve(supabase.from("places").select("id, trip_id").eq("id", id).maybeSingle()) : null;
  const {
    data: { user },
  } = await authP;
  if (!user) return jsonError("Please sign in", 401);
  if (parsed.error) return parsed.error;
  const input = parsed.data;

  if ("priority" in input) {
    const { data, error } = await supabase.from("places").update({ priority: input.priority }).eq("id", id).select("id");
    if (error) return dbError(error, "priority: update");
    if (!data || data.length === 0) return jsonError("Place not found", 404);
    return NextResponse.json({ ok: true });
  }

  if ("status" in input) {
    const { data, error } = await supabase
      .from("places")
      .update({ status: input.status, status_at: input.status === "planned" ? null : new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (error) return dbError(error, "status: update");
    if (!data || data.length === 0) return jsonError("Place not found", 404);
    return NextResponse.json({ ok: true });
  }

  if ("lat" in input) {
    // A moved pin invalidates the old drive leg and arrival time; re-run Auto-plan to recompute them.
    const { data, error } = await supabase
      .from("places")
      .update({
        lat: input.lat,
        lng: input.lng,
        ...(input.name ? { name: input.name } : {}),
        address: input.address,
        drive_minutes: null,
        drive_km: null,
        arrival_time: null,
      })
      .eq("id", id)
      .select("id");
    if (error) return dbError(error, "relocate: update");
    if (!data || data.length === 0) return jsonError("Place not found", 404);
    return NextResponse.json({ ok: true });
  }

  const { data: current, error: findError } = await findP!;
  if (findError) return dbError(findError, "patch: find");
  if (!current) return jsonError("Place not found", 404);

  const q = supabase
    .from("places")
    .select("sequence_order")
    .eq("trip_id", current.trip_id)
    .order("sequence_order", { ascending: false, nullsFirst: false })
    .limit(1);
  const { data: last } = await (input.day_number === null ? q.is("day_number", null) : q.eq("day_number", input.day_number)).maybeSingle();

  // Moving invalidates the old plan details for this stop.
  const { error } = await supabase
    .from("places")
    .update({ day_number: input.day_number, sequence_order: (last?.sequence_order ?? 0) + 1, arrival_time: null, drive_minutes: null, drive_km: null, status: "planned", status_at: null })
    .eq("id", id);
  if (error) return dbError(error, "move: update");
  return NextResponse.json({ ok: true });
}
