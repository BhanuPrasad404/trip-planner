import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { consumeQuota } from "@/lib/quota";
import { loadBuilder } from "@/lib/server/builder";
import { todayISO } from "@/lib/server/trip-data";
import { hhmm } from "@/lib/trip-builder";
import { builderApplySchema, uuid } from "@/lib/validation/schemas";

export const maxDuration = 30;

// Applies a plan option. The server RE-COMPUTES it (the client's copy is never trusted) and refuses if the places changed since
// the traveller looked at the preview. Dropped places go back to Ideas — nothing is deleted. One atomic upsert.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const { data: input, error: bodyError } = await parseBody(req, builderApplySchema);
  if (bodyError) return bodyError;
  if (!(await consumeQuota(supabase, "builder_apply", 40))) return jsonError("Too many plan changes today. Please try again tomorrow.", 429);

  const r = await loadBuilder(supabase, id, { endMode: input.end_mode, styles: [input.style], todayISO: await todayISO(), userId: user.id });
  if (!r.ok) return jsonError(r.error, r.status);
  if (r.signature !== input.signature) return jsonError("Your places or dates changed since this preview. Refresh the options and choose again.", 409);
  const option = r.result.options[0];
  if (!option) return jsonError("Nothing to apply.", 422);

  const byId = new Map(r.input.places.map((p) => [p.id, p]));
  const placed = option.days.flatMap((d) => d.stops.map((s) => ({
    id: s.placeId, day_number: s.day, sequence_order: s.order, arrival_time: hhmm(s.arriveMin), drive_minutes: Math.round(s.driveMin), drive_km: s.driveKm,
  })));
  const dropped = option.removed.map((x) => ({ id: x.placeId, day_number: null, sequence_order: null, arrival_time: null, drive_minutes: null, drive_km: null }));
  const rows = [...placed, ...dropped].map((row) => {
    const p = byId.get(row.id)!;
    return { ...row, trip_id: id, name: p.name, lat: p.lat, lng: p.lng };
  });
  if (rows.length === 0) return jsonError("Nothing to apply.", 422);
  const { error } = await supabase.from("places").upsert(rows, { onConflict: "id" });
  if (error) return dbError(error, "builder: apply");
  return NextResponse.json({ ok: true, placed: placed.length, movedToIdeas: dropped.length, daysUsed: option.totals.daysUsed });
}
