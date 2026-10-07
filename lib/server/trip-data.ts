// Server-side data loading for the trip pages. Each page asks only for what it shows (weather and community updates are optional),
// and the trip itself is fetched once per request even when both the layout and the page need it.
import { cookies } from "next/headers";
import { cache } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { dateOfTripDay, parseISODate } from "@/lib/dates";
import { weatherProvider } from "@/lib/providers/registry";
import { REPORT_MAX_AGE_DAYS, REPORT_PHOTO_BUCKET, assignReports, type PlaceReportRow, type ReportView } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import type { PlaceWithSeason, Trip, TripMember } from "@/lib/types";
import { TZ_COOKIE, localDateFor, parseTzOffset } from "@/lib/tz";
import { uuid } from "@/lib/validation/schemas";
import { summarizeVotes, type VoteSummary } from "@/lib/votes";
import type { Conditions } from "@/lib/weather";

/** Today's date for THIS traveller (their timezone, from the tm_tz cookie); UTC until the browser has told us. */
export async function todayISO(): Promise<string> {
  const store = await cookies();
  return localDateFor(Date.now(), parseTzOffset(store.get(TZ_COOKIE)?.value));
}

/** The trip (RLS makes this empty for non-members — same as "not found", so we never reveal whether an id exists). */
export const getTrip = cache(async (id: string): Promise<Trip | null> => {
  if (!uuid.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
  return (data as Trip | null) ?? null;
});

export const getMembers = cache(async (id: string): Promise<TripMember[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("trip_members").select("*").eq("trip_id", id).order("joined_at", { ascending: true });
  return (data ?? []) as TripMember[];
});

export type TripBundle = {
  trip: Trip;
  places: PlaceWithSeason[];
  members: TripMember[];
  votes: Record<string, VoteSummary>;
  conditions: Record<string, Conditions>;
  reports: Record<string, ReportView[]>;
  userId: string;
  today: string;
};

export async function loadTripBundle(id: string, nextPath: string, opts: { weather?: boolean; reports?: boolean } = {}): Promise<TripBundle> {
  const { supabase, user } = await requireUser(nextPath);
  const trip = await getTrip(id);
  if (!trip) notFound();
  const today = await todayISO();

  const placesQuery = (cols: string) =>
    supabase.from("places").select(`*, season_tags(${cols})`).eq("trip_id", id).order("day_number", { ascending: true }).order("sequence_order", { ascending: true });
  const [placesFull, members, votesRes] = await Promise.all([
    placesQuery("good_months, reason, category, confidence, source_urls"),
    getMembers(id),
    supabase.from("place_votes").select("place_id, user_id, vote").eq("trip_id", id),
  ]);
  // If the newest season migration isn't applied yet, retry without those columns so the trip still opens.
  const placesRes = placesFull.error ? await placesQuery("good_months, reason, category") : placesFull;
  if (placesRes.error) throw new Error(`Failed to load places: ${placesRes.error.message}`);
  if (votesRes.error) console.error("[trip] votes unavailable:", votesRes.error.message);
  const places = (placesRes.data ?? []) as unknown as PlaceWithSeason[];

  // Weather for each stop on ITS visit date (forecast if soon, otherwise 6-year typical). Best-effort.
  let conditions: Record<string, Conditions> = {};
  if (opts.weather !== false && places.length > 0) {
    const fallback = parseISODate(today) ?? new Date();
    conditions = await weatherProvider().conditionsFor(
      places.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, date: dateOfTripDay(trip.start_date, p.day_number ?? 1) ?? fallback })),
      today
    );
  }

  // Community updates near each stop (best-effort; optional table).
  let reports: Record<string, ReportView[]> = {};
  if (opts.reports !== false && places.length > 0) {
    const boxes = new Map<string, string>();
    for (const p of places.slice(0, 60)) {
      const lngPad = 0.02 / Math.max(0.2, Math.cos((p.lat * Math.PI) / 180));
      boxes.set(`${p.lat.toFixed(2)},${p.lng.toFixed(2)}`, `and(lat.gte.${(p.lat - 0.02).toFixed(4)},lat.lte.${(p.lat + 0.02).toFixed(4)},lng.gte.${(p.lng - lngPad).toFixed(4)},lng.lte.${(p.lng + lngPad).toFixed(4)})`);
    }
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - REPORT_MAX_AGE_DAYS * 86_400_000).toISOString();
    const { data: rows, error } = await supabase
      .from("place_reports")
      .select("id, user_id, place_name, lat, lng, tags, note, photo_path, created_at")
      .gte("created_at", since)
      .or([...boxes.values()].join(","))
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) console.error("[trip] reports unavailable:", error.message);
    else {
      reports = assignReports(
        places.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng })),
        (rows ?? []) as PlaceReportRow[],
        user.id,
        (path) => supabase.storage.from(REPORT_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
      );
    }
  }

  return { trip, places, members, votes: summarizeVotes((votesRes.data ?? []) as { place_id: string; user_id: string; vote: -1 | 1 }[], user.id), conditions, reports, userId: user.id, today };
}
