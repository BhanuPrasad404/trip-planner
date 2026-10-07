import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError } from "@/lib/api";
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { planTrip } from "@/lib/planner";
import { getMatrix } from "@/lib/routing";
import { uuid } from "@/lib/validation/schemas";

export const maxDuration = 30;

// Re-plans the whole trip using REAL driving times: orders stops (nearest-neighbour + 2-opt),
// splits them into days by total hours (driving + sightseeing), and sets estimated arrival
// times and the drive leg for every stop.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, num_days, start_lat, start_lng")
    .eq("id", id)
    .maybeSingle();
  if (tripError) return dbError(tripError, "optimize: load trip");
  if (!trip) return jsonError("Trip not found", 404);
  if (trip.start_lat == null || trip.start_lng == null) {
    return jsonError("Set a starting point for this trip before auto-planning", 422);
  }

  const { data: places, error: placesError } = await supabase
    .from("places")
    .select("id, trip_id, name, lat, lng, category, day_number, sequence_order, status, season_tags(category)")
    .eq("trip_id", id);
  if (placesError) return dbError(placesError, "optimize: load places");
  if (!places || places.length === 0) return jsonError("Add some stops first", 422);

  // Trip mode: stops already done or skipped stay exactly where they are. Only the rest is re-planned,
  // and it continues AFTER the finished stops of each day.
  const finished = places.filter((p) => p.status === "done" || p.status === "skipped");
  const baseByDay = new Map<number, number>();
  for (const p of finished) {
    if (p.day_number != null) baseByDay.set(p.day_number, Math.max(baseByDay.get(p.day_number) ?? 0, p.sequence_order ?? 0));
  }
  const open = places.filter((p) => p.status !== "done" && p.status !== "skipped");
  if (open.length === 0) return jsonError("Every stop is already done or skipped — nothing left to plan.", 422);

  const tagCategory = (p: (typeof places)[number]) => {
    const t = p.season_tags as { category: string | null } | { category: string | null }[] | null;
    return Array.isArray(t) ? t[0]?.category : t?.category;
  };
  const stops = open.map((p) => ({
    id: p.id,
    visitHours: CATEGORIES[normalizeCategory(p.category ?? tagCategory(p))].hours,
  }));

  const matrix = await getMatrix([{ lat: trip.start_lat, lng: trip.start_lng }, ...open.map((p) => ({ lat: p.lat, lng: p.lng }))]);
  const plan = planTrip(stops, trip.num_days, matrix, { names: Object.fromEntries(open.map((p) => [p.id, p.name])) });
  const byId = new Map(open.map((p) => [p.id, p]));

  // One atomic statement (INSERT … ON CONFLICT DO UPDATE): all stops move or none do.
  const rows = plan.stops.map((s) => {
    const p = byId.get(s.id)!;
    return {
      id: s.id, trip_id: id, name: p.name, lat: p.lat, lng: p.lng,
      day_number: s.day_number, sequence_order: (baseByDay.get(s.day_number) ?? 0) + s.sequence_order,
      arrival_time: s.arrival_time, drive_minutes: s.drive_minutes, drive_km: s.drive_km,
    };
  });
  const { error } = await supabase.from("places").upsert(rows, { onConflict: "id" });
  if (error) return dbError(error, "optimize: save plan");

  return NextResponse.json({
    ok: true,
    stops: rows.length,
    daysUsed: plan.days.length,
    routing: matrix.source,
    days: plan.days,
    warnings: plan.warnings,
  });
}
