// SERVER ONLY. A trip's bookings and time-bound activities (table `trip_commitments`, migration 20261103000000), read for planning.
//
// A place saved to a trip is NOT a booking. A commitment exists only because a traveller entered one, and it says where that came from:
//   user_entered       the traveller typed it ("I booked Hotel X for night 3"): taken at their word, shown as theirs
//   imported           read from something they shared (a booking email, a confirmation): evidence, still not confirmed by us
//   confirmed          the traveller says it is confirmed with the provider (a reference or a call): protected like a promise
// Only `confirmed` bookings block a plan; the others are warnings. Without the table (migration not applied) there are no commitments and
// planning works as before.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Commitment } from "@/lib/trip/replan-proposal";

/** What a set of commitments is, in one short string: it changes when one is added, removed or edited, so a suggestion made before can be recognised as out of date. */
export function commitmentsSignature(map: Map<string, Commitment>): string {
  const rows = [...map].map(([id, c]) => `${id}|${c.kind}|${c.day}|${c.earliestArriveMin ?? ""}|${c.latestArriveMin ?? ""}|${c.confirmed ? 1 : 0}`).sort();
  let h = 5381;
  for (const ch of rows.join("|")) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `${rows.length}:${h.toString(36)}`;
}

export type CommitmentRow = {
  id: string; trip_id: string; place_id: string | null; label: string; kind: "hotel" | "ticket" | "event" | "reservation" | "transport" | "activity";
  /** How it constrains the plan: fixed (the date cannot move) or time_sensitive (the day is fixed and there is a time window). */
  constraint_class: "fixed" | "time_sensitive";
  day: number; earliest_min: number | null; latest_min: number | null;
  source: "user_entered" | "imported" | "confirmed"; notes: string | null; created_by: string | null; created_at: string;
};

/** The commitments of a trip that are attached to a stop, as the planner reads them. Missing table: none. */
export async function loadCommitments(supabase: SupabaseClient, tripId: string): Promise<Map<string, Commitment>> {
  const out = new Map<string, Commitment>();
  try {
    const { data, error } = await supabase.from("trip_commitments").select("id, place_id, label, constraint_class, day, earliest_min, latest_min, source").eq("trip_id", tripId).not("place_id", "is", null).limit(200);
    if (error || !data) return out;
    for (const r of data as Pick<CommitmentRow, "place_id" | "label" | "constraint_class" | "day" | "earliest_min" | "latest_min" | "source">[]) {
      if (!r.place_id || out.has(r.place_id)) continue;
      out.set(r.place_id, { kind: r.constraint_class === "fixed" ? "fixed" : "time-sensitive", day: r.day, earliestArriveMin: r.earliest_min, latestArriveMin: r.latest_min, confirmed: r.source === "confirmed", label: r.label });
    }
  } catch { /* the table is not there: no commitments */ }
  return out;
}
