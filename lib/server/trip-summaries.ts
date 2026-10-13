// Small per-trip facts for lists and the dashboard (counts only — never the whole itinerary).
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysUntilStart, tripOutcome, tripState, type TripOutcome, type TripState } from "@/lib/trip-state";
import type { Trip } from "@/lib/types";

export type TripSummary = Trip & {
  state: TripState;
  /** What to print: "Completed" only when something was actually done; otherwise "Ended". See lib/trip-state.ts. */
  outcome: TripOutcome;
  daysUntil: number | null;
  stops: number; // scheduled on a day
  ideas: number; // collected but not scheduled
  done: number;
  skipped: number;
};

/** Everything the trip lists AND "Plan vs reality" need about stops, in ONE request (they used to be two separate ones). */
export type PlaceRow = { trip_id: string; name: string; category: string | null; day_number: number | null; status: string | null; status_at: string | null; arrival_time: string | null };
export const PLACE_ROW_COLUMNS = "trip_id, name, category, day_number, status, status_at, arrival_time";

export async function loadPlaceRows(supabase: SupabaseClient, tripIds: string[]): Promise<PlaceRow[]> {
  if (tripIds.length === 0) return [];
  const { data } = await supabase.from("places").select(PLACE_ROW_COLUMNS).in("trip_id", tripIds).limit(5000);
  return (data ?? []) as PlaceRow[];
}

/** Pure: per-trip counts + state from trips and their stop rows already in hand. */
export function summarizeTripsFrom(trips: Trip[], rows: { trip_id: string; day_number: number | null; status: string | null }[], today: string): TripSummary[] {
  const counts = new Map<string, { stops: number; ideas: number; done: number; skipped: number }>();
  for (const p of rows) {
    const c = counts.get(p.trip_id) ?? { stops: 0, ideas: 0, done: 0, skipped: 0 };
    if (p.day_number === null) c.ideas++;
    else {
      c.stops++;
      if (p.status === "done") c.done++;
      if (p.status === "skipped") c.skipped++;
    }
    counts.set(p.trip_id, c);
  }
  return trips.map((t) => {
    const c = counts.get(t.id) ?? { stops: 0, ideas: 0, done: 0, skipped: 0 };
    const state = tripState(t, today);
    return { ...t, state, outcome: tripOutcome(state, c), daysUntil: daysUntilStart(t, today), ...c };
  });
}

export async function summarizeTrips(supabase: SupabaseClient, trips: Trip[], today: string): Promise<TripSummary[]> {
  const rows = await loadPlaceRows(supabase, trips.map((t) => t.id));
  return summarizeTripsFrom(trips, rows, today);
}

/** Where should the traveller go next for this trip? One obvious answer per state. */
export function primaryAction(t: TripSummary): { label: string; href: string } {
  const base = `/trips/${t.id}`;
  if (t.state === "active") return { label: "Open live trip", href: `${base}/live` };
  if (t.state === "completed") return { label: "See memories", href: `${base}/memories` };
  if (t.stops === 0) return { label: t.ideas > 0 ? "Schedule your ideas" : "Add places", href: `${base}/plan` };
  return { label: "Continue planning", href: `${base}/plan` };
}
