import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { consumeQuota } from "@/lib/quota";
import { loadBuilder } from "@/lib/server/builder";
import { runEngine } from "@/lib/server/trip-engine";
import { todayISO } from "@/lib/server/trip-data";
import { clock24 } from "@/lib/trip-builder";
import { randomUUID } from "node:crypto";
import { haltRows, PLAN_HALT_SOURCE } from "@/lib/engine/halt-stops";
import type { TransitDay } from "@/lib/engine/types";
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

  const today = await todayISO();
  const r = await loadBuilder(supabase, id, { endMode: input.end_mode, styles: input.engine ? [] : [input.style], todayISO: today, userId: user.id, skip: input.skip });
  if (!r.ok) return jsonError(r.error, r.status);
  if (r.signature !== input.signature) return jsonError("Your places or dates changed since this preview. Refresh the options and choose again.", 409);
  let option = r.result.options[0];
  let transit: TransitDay[] = [];
  if (input.engine) {
    // The engine's plan, re-computed the same way the preview was (tolls are not needed to save a plan). Its day numbers already count
    // the drive days to a far-away area, so places land on the right trip day.
    try {
      const run = await runEngine(r.input, { intake: r.trip.intake ?? null, todayISO: today, nightDriving: input.night_driving, maxDriveHours: input.max_drive_hours, checkTolls: false });
      const chosen = run.plan.variants.find((v) => v.option.style === input.style);
      option = chosen?.option ?? option;
      transit = [...(chosen?.transitOut ?? []), ...(chosen?.transitBack ?? [])];
    } catch (e) {
      console.error("engine: apply failed", e);
      return jsonError("Couldn't re-check this plan right now. Please try again.", 503);
    }
  }
  if (!option) return jsonError("Nothing to apply.", 422);

  const byId = new Map<string, { name: string; lat: number; lng: number }>([...r.input.places.map((p) => [p.id, p] as const), ...r.skipped.map((s) => [s.id, s] as const)]);
  const placed = option.days.flatMap((d) => d.stops.map((s) => ({
    id: s.placeId, day_number: s.day, sequence_order: s.order, arrival_time: clock24(s.arriveMin), drive_minutes: Math.round(s.driveMin), drive_km: s.driveKm,
  })));
  const dropped = option.removed.map((x) => ({ id: x.placeId, day_number: null, sequence_order: null, arrival_time: null, drive_minutes: null, drive_km: null }));
  // Places the traveller skipped go back to Ideas too (only this trip's own places: loadBuilder found them in this trip).
  for (const s of r.skipped) dropped.push({ id: s.id, day_number: null, sequence_order: null, arrival_time: null, drive_minutes: null, drive_km: null });
  const rows = [...placed, ...dropped].map((row) => {
    const p = byId.get(row.id)!;
    return { ...row, trip_id: id, name: p.name, lat: p.lat, lng: p.lng };
  });
  if (rows.length === 0) return jsonError("Nothing to apply.", 422);
  // The drive days (to a far-away area and home) end at a halt town: saved as that day's stop, so the day is not empty on the Plan, Map and
  // Live screens. Halts from an earlier plan are replaced.
  const halts = haltRows(transit, id, user.id, randomUUID);
  const { error } = await supabase.from("places").upsert([...rows, ...halts], { onConflict: "id" });
  if (error) return dbError(error, "builder: apply");
  const stale = supabase.from("places").delete().eq("trip_id", id).eq("source_type", PLAN_HALT_SOURCE);
  const { error: staleError } = await (halts.length ? stale.not("id", "in", `(${halts.map((h) => h.id).join(",")})`) : stale);
  if (staleError) return dbError(staleError, "builder: apply (old halts)");
  return NextResponse.json({ ok: true, placed: placed.length, movedToIdeas: dropped.length, daysUsed: option.totals.daysUsed, halts: halts.length });
}
