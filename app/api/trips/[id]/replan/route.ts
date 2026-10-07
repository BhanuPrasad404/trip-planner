import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { replanDay, toMinutes, tripDayForDate } from "@/lib/replan";
import { getMatrix } from "@/lib/routing";
import { replanSchema, uuid } from "@/lib/validation/schemas";

export const maxDuration = 30;

type Row = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: string | null;
  day_number: number | null;
  sequence_order: number | null;
  status: "planned" | "done" | "skipped" | null;
  status_at: string | null;
  season_tags: { category: string | null } | { category: string | null }[] | null;
};

// Trip mode: re-plan the rest of TODAY from where the group is and what time it is.
// Done/skipped stops are left alone. Stops that no longer fit move to tomorrow (or back to Ideas on the last day).
// The device location (if sent) is used for this one request only — it is never stored.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, replanSchema);
  if (bodyError) return bodyError;

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, num_days, start_date, start_lat, start_lng")
    .eq("id", id)
    .maybeSingle();
  if (tripError) return dbError(tripError, "replan: load trip");
  if (!trip) return jsonError("Trip not found", 404);

  // Normally "today" must be one of the trip's days. EARLY START: if today is before the first planned day, the traveller
  // may drive a planned day now — but only a real day of this trip, and only when the trip really hasn't started yet.
  let day = tripDayForDate(trip.start_date, input.local_date, trip.num_days);
  if (day === null && input.day_number !== undefined && trip.start_date && input.local_date < trip.start_date && input.day_number <= trip.num_days) day = input.day_number;
  if (day === null) return jsonError("Today isn't one of this trip's days, so there is nothing to re-plan.", 422);

  const { data: all, error: placesError } = await supabase
    .from("places")
    .select("id, name, lat, lng, category, day_number, sequence_order, status, status_at, season_tags(category)")
    .eq("trip_id", id);
  if (placesError) return dbError(placesError, "replan: load places");
  const places = (all ?? []) as unknown as Row[];

  const today = places.filter((p) => p.day_number === day);
  const remaining = today.filter((p) => (p.status ?? "planned") === "planned");
  if (remaining.length === 0) return jsonError("Nothing left to re-plan today — every stop is done or skipped.", 422);

  // Where are we starting from? Device location > last finished stop today > yesterday's last stop > trip start.
  let origin: { lat: number; lng: number } | null = null;
  let originLabel = "";
  if (input.lat !== undefined && input.lng !== undefined) {
    origin = { lat: input.lat, lng: input.lng };
    originLabel = "your location";
  } else {
    const lastDone = today
      .filter((p) => p.status === "done" && p.status_at)
      .sort((a, b) => (b.status_at ?? "").localeCompare(a.status_at ?? ""))[0];
    const yesterdayLast =
      day > 1
        ? places
            .filter((p) => p.day_number === day - 1)
            .sort((a, b) => (b.sequence_order ?? 0) - (a.sequence_order ?? 0))[0]
        : undefined;
    if (lastDone) {
      origin = { lat: lastDone.lat, lng: lastDone.lng };
      originLabel = lastDone.name;
    } else if (yesterdayLast) {
      origin = { lat: yesterdayLast.lat, lng: yesterdayLast.lng };
      originLabel = yesterdayLast.name;
    } else if (trip.start_lat != null && trip.start_lng != null) {
      origin = { lat: trip.start_lat, lng: trip.start_lng };
      originLabel = "the trip start";
    }
  }
  if (!origin) return jsonError("We don't know where you are. Allow location access, or set a start point for this trip.", 422);

  const tagCategory = (p: Row) => (Array.isArray(p.season_tags) ? p.season_tags[0]?.category : p.season_tags?.category);
  const stops = remaining.map((p) => ({
    id: p.id,
    visitHours: CATEGORIES[normalizeCategory(p.category ?? tagCategory(p))].hours,
  }));
  const now = toMinutes(input.local_time) ?? 0;

  const matrix = await getMatrix([origin, ...remaining.map((p) => ({ lat: p.lat, lng: p.lng }))]);
  const plan = replanDay(stops, matrix, { nowMinutes: now, names: Object.fromEntries(remaining.map((p) => [p.id, p.name])) });
  const byId = new Map(remaining.map((p) => [p.id, p]));

  // Finished/skipped stops keep their slots; the rest continue after them.
  const base = Math.max(0, ...today.filter((p) => (p.status ?? "planned") !== "planned").map((p) => p.sequence_order ?? 0));
  const rows: Record<string, unknown>[] = plan.scheduled.map((s) => {
    const p = byId.get(s.id)!;
    return {
      id: s.id, trip_id: id, name: p.name, lat: p.lat, lng: p.lng,
      day_number: day, sequence_order: base + s.sequence_order,
      arrival_time: s.arrival_time, drive_minutes: s.drive_minutes, drive_km: s.drive_km,
    };
  });

  // Overflow: next day if there is one (appended; Auto-plan can tidy later), otherwise back to Ideas.
  const warnings = [...plan.warnings];
  const nextDay = day < trip.num_days ? day + 1 : null;
  let nextSeq = Math.max(0, ...places.filter((p) => p.day_number === nextDay).map((p) => p.sequence_order ?? 0));
  for (const oid of plan.overflow) {
    const p = byId.get(oid)!;
    nextSeq += 1;
    rows.push({
      id: oid, trip_id: id, name: p.name, lat: p.lat, lng: p.lng,
      day_number: nextDay, sequence_order: nextSeq,
      arrival_time: null, drive_minutes: null, drive_km: null,
    });
  }
  if (plan.overflow.length > 0) {
    warnings.push(
      nextDay === null
        ? "This was the last day, so those stops went back to Ideas."
        : `Day ${nextDay} now has extra stops — run Auto-plan to re-balance it.`
    );
  }

  const { error } = await supabase.from("places").upsert(rows, { onConflict: "id" });
  if (error) return dbError(error, "replan: save");

  return NextResponse.json({
    ok: true,
    day,
    origin: originLabel,
    scheduled: plan.scheduled.length,
    moved: plan.overflow.length,
    lastArrival: plan.scheduled.length ? plan.scheduled[plan.scheduled.length - 1].arrival_time : null,
    routing: matrix.source,
    warnings,
  });
}
