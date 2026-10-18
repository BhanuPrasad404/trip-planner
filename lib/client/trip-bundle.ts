// The data a live drive needs, loaded in the browser: used when the drive carries on while the traveller is on ANOTHER page
// (Discover, Profile…) or after a reload that did not start on the trip's own page. Same queries as the server page
// (lib/server/trip-data.ts); access is still decided by Row Level Security. Weather is not loaded here (the server pages do that):
// a drive needs the stops, not the forecast, and the last known forecast is kept.
import { createClient } from "@/lib/supabase/client";
import { summarizeVotes, type VoteSummary } from "@/lib/votes";
import { localDateFor } from "@/lib/tz";
import { INDIA_UTC_OFFSET_MIN } from "@/lib/travel/clock";
import type { Conditions } from "@/lib/weather";
import type { PlaceWithSeason, Trip, TripMember } from "@/lib/types";

export type TripData = {
  trip: Trip;
  places: PlaceWithSeason[];
  members: TripMember[];
  votes: Record<string, VoteSummary>;
  conditions: Record<string, Conditions>;
  userId: string;
  today: string;
};

/** "gone": the trip is not visible any more (deleted, or the person was removed). "error": offline or a server problem (proves nothing). */
export type LoadResult = { ok: true; data: TripData } | { ok: false; reason: "gone" | "error" };

export async function loadTripData(tripId: string, userId: string, keep?: Pick<TripData, "conditions"> | null, now: number = Date.now()): Promise<LoadResult> {
  try {
    const sb = createClient();
    const places = (cols: string) => sb.from("places").select(`*, season_tags(${cols})`).eq("trip_id", tripId).order("day_number", { ascending: true }).order("sequence_order", { ascending: true });
    const [trip, full, members, votes] = await Promise.all([
      sb.from("trips").select("*").eq("id", tripId).maybeSingle(),
      places("good_months, reason, category, confidence, source_urls"),
      sb.from("trip_members").select("*").eq("trip_id", tripId).order("joined_at", { ascending: true }),
      sb.from("place_votes").select("place_id, user_id, vote").eq("trip_id", tripId),
    ]);
    if (trip.error) return { ok: false, reason: "error" };
    if (!trip.data) return { ok: false, reason: "gone" };
    const placesRes = full.error ? await places("good_months, reason, category") : full;
    if (placesRes.error || members.error) return { ok: false, reason: "error" };
    return {
      ok: true,
      data: {
        trip: trip.data as Trip,
        places: (placesRes.data ?? []) as unknown as PlaceWithSeason[],
        members: (members.data ?? []) as TripMember[],
        votes: votes.error ? {} : summarizeVotes((votes.data ?? []) as { place_id: string; user_id: string; vote: -1 | 1 }[], userId),
        conditions: keep?.conditions ?? {},
        userId,
        today: localDateFor(now, INDIA_UTC_OFFSET_MIN),
      },
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}
