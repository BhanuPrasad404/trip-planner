// Small per-trip facts for lists and the dashboard (counts only — never the whole itinerary).
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysUntilStart, tripState, type TripState } from "@/lib/trip-state";
import type { Trip } from "@/lib/types";

export type TripSummary = Trip & {
  state: TripState;
  daysUntil: number | null;
  stops: number; // scheduled on a day
  ideas: number; // collected but not scheduled
  done: number;
  skipped: number;
};

export async function summarizeTrips(supabase: SupabaseClient, trips: Trip[], today: string): Promise<TripSummary[]> {
  const counts = new Map<string, { stops: number; ideas: number; done: number; skipped: number }>();
  if (trips.length > 0) {
    const { data } = await supabase.from("places").select("trip_id, day_number, status").in("trip_id", trips.map((t) => t.id)).limit(5000);
    for (const p of (data ?? []) as { trip_id: string; day_number: number | null; status: string | null }[]) {
      const c = counts.get(p.trip_id) ?? { stops: 0, ideas: 0, done: 0, skipped: 0 };
      if (p.day_number === null) c.ideas++;
      else {
        c.stops++;
        if (p.status === "done") c.done++;
        if (p.status === "skipped") c.skipped++;
      }
      counts.set(p.trip_id, c);
    }
  }
  return trips.map((t) => ({ ...t, state: tripState(t, today), daysUntil: daysUntilStart(t, today), ...(counts.get(t.id) ?? { stops: 0, ideas: 0, done: 0, skipped: 0 }) }));
}

/** Where should the traveller go next for this trip? One obvious answer per state. */
export function primaryAction(t: TripSummary): { label: string; href: string } {
  const base = `/trips/${t.id}`;
  if (t.state === "active") return { label: "Open live trip", href: `${base}/live` };
  if (t.state === "completed") return { label: "See memories", href: `${base}/memories` };
  if (t.stops === 0) return { label: t.ideas > 0 ? "Schedule your ideas" : "Add places", href: `${base}/plan` };
  return { label: "Continue planning", href: `${base}/plan` };
}
