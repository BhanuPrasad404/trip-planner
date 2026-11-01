// SERVER ONLY. Writing the journey's history (trip_events) and the approved plan's snapshots (trip_plan_revisions), tolerating a
// database where migration 20261102000000 has not been applied: then nothing is recorded and nothing breaks (`missing`).
// Recording is best effort around the traveller's own action: it never turns a saved change into a failure.
import type { SupabaseClient } from "@supabase/supabase-js";
import { JOURNEY_KINDS, type JourneyEvent, type JourneyKind, type EventSource, type MetaValue } from "@/lib/trip/journey";

type DbError = { code?: string; message?: string } | null;
/** The tables of migration 20261102000000 are not in the database yet. */
export const tableMissing = (e: DbError): boolean => !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204" || e.code === "42703" || /relation .* does not exist|schema cache|could not find the table/i.test(e.message ?? ""));
const isDuplicate = (e: DbError): boolean => !!e && e.code === "23505";

export type EventRow = {
  trip_id: string; user_id: string | null; place_id: string | null; place_name: string | null; kind: string; occurred_at: string; recorded_at?: string;
  source: string; accuracy_m: number | null; client_event_id: string; meta: Record<string, MetaValue> | null;
};
export const EVENT_COLUMNS = "trip_id, user_id, place_id, place_name, kind, occurred_at, recorded_at, source, accuracy_m, client_event_id, meta";

const kinds = new Set<string>(JOURNEY_KINDS);
/** A stored row as the pure journey code reads it. A row of an unknown kind (a newer app wrote it) is skipped, never guessed. */
export function rowToEvent(r: EventRow): JourneyEvent | null {
  if (!kinds.has(r.kind) || !Number.isFinite(Date.parse(r.occurred_at))) return null;
  return {
    clientEventId: r.client_event_id, kind: r.kind as JourneyKind, occurredAt: r.occurred_at, recordedAt: r.recorded_at ?? null,
    source: (r.source === "gps" || r.source === "system" ? r.source : "manual") as EventSource, accuracyM: r.accuracy_m ?? null,
    placeId: r.place_id, placeName: r.place_name, userId: r.user_id, meta: r.meta ?? {},
  };
}

export type NewEvent = {
  tripId: string; userId: string; kind: JourneyKind; occurredAt: string; source: EventSource; clientEventId: string;
  placeId?: string | null; placeName?: string | null; accuracyM?: number | null; meta?: Record<string, MetaValue>;
};
export type RecordResult = { ok: true; duplicate?: boolean } | { ok: false; missing: boolean; error?: DbError };

/** Append one event. The same client event id twice is a duplicate, not an error and not a second row. */
export async function recordEvent(supabase: SupabaseClient, e: NewEvent): Promise<RecordResult> {
  const { error } = await supabase.from("trip_events").insert({
    trip_id: e.tripId, user_id: e.userId, place_id: e.placeId ?? null, place_name: e.placeName ? e.placeName.slice(0, 120) : null, kind: e.kind,
    occurred_at: e.occurredAt, source: e.source, accuracy_m: e.accuracyM ?? null, client_event_id: e.clientEventId, meta: e.meta ?? {},
  });
  if (!error) return { ok: true };
  if (isDuplicate(error)) return { ok: true, duplicate: true };
  return { ok: false, missing: tableMissing(error), error };
}

/** Every arrival and "not here yet" said about one place on a trip (everyone's), or null when the history is not available. */
export async function loadArrivalEvents(supabase: SupabaseClient, tripId: string, placeId: string): Promise<JourneyEvent[] | null> {
  try {
    const { data, error } = await supabase.from("trip_events").select(EVENT_COLUMNS).eq("trip_id", tripId).eq("place_id", placeId).in("kind", ["arrived", "arrival_corrected"]).order("occurred_at", { ascending: true }).limit(200);
    if (error) return null;
    return ((data ?? []) as EventRow[]).map(rowToEvent).filter((e): e is JourneyEvent => e !== null);
  } catch {
    return null; // never turns a saved change into a failure: without the history, a place simply has no other arrivals
  }
}

export type SnapshotRow = { id: string; name: string; day: number | null; order: number | null; arrival_time: string | null; drive_minutes: number | null; drive_km: number | null };
export const MAX_SNAPSHOT_STOPS = 300;
type PlaceRow = { id: string; name: string; day_number: number | null; sequence_order: number | null; arrival_time: string | null; drive_minutes: number | null; drive_km: number | null };

export const toSnapshot = (rows: PlaceRow[]): SnapshotRow[] =>
  rows.slice(0, MAX_SNAPSHOT_STOPS).map((p) => ({ id: p.id, name: p.name, day: p.day_number, order: p.sequence_order, arrival_time: p.arrival_time, drive_minutes: p.drive_minutes, drive_km: p.drive_km }));

/**
 * Keep the schedule that was just approved. The FIRST one is the original itinerary (kind "original"); later ones are "approved". Every
 * stop is kept, including those back in Ideas, so a stop can never silently vanish from the record. Returns the revision number, or
 * null when nothing was kept (the tables are missing, or the database refused: said, never thrown).
 */
export type RevisionKind = "original" | "approved" | "proposed" | "rejected";
export async function recordRevision(supabase: SupabaseClient, tripId: string, userId: string, snapshot: SnapshotRow[], reason: string | null, opts: { kind?: Exclude<RevisionKind, "original">; meta?: Record<string, unknown> } = {}): Promise<number | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const last = await supabase.from("trip_plan_revisions").select("rev").eq("trip_id", tripId).order("rev", { ascending: false }).limit(1);
    if (last.error) { if (!tableMissing(last.error)) console.error("[journey] revisions: read failed", last.error.code, last.error.message); return null; }
    const rev = ((last.data as { rev: number }[] | null)?.[0]?.rev ?? 0) + 1;
    const { error } = await supabase.from("trip_plan_revisions").insert({ trip_id: tripId, rev, kind: rev === 1 ? "original" : opts.kind ?? "approved", snapshot, reason: reason ? reason.slice(0, 300) : null, meta: opts.meta ?? {}, created_by: userId });
    if (!error) return rev;
    if (!isDuplicate(error)) { if (!tableMissing(error)) console.error("[journey] revisions: write failed", error.code, error.message); return null; }
    // Two devices approved at once and took the same number: the other one won it, so ours takes the next.
  }
  return null;
}

export type RevisionRow = { rev: number; kind: RevisionKind; snapshot?: SnapshotRow[]; meta?: Record<string, unknown> | null; reason?: string | null; created_at?: string; created_by?: string | null };
/** The revision log (newest first), or null when the history tables are not there. */
export async function loadRevisions(supabase: SupabaseClient, tripId: string, withSnapshot = false, limit = 200): Promise<RevisionRow[] | null> {
  const { data, error } = await supabase.from("trip_plan_revisions").select(withSnapshot ? "rev, kind, snapshot, meta, reason, created_at, created_by" : "rev, kind, meta, reason, created_at, created_by").eq("trip_id", tripId).order("rev", { ascending: false }).limit(limit);
  if (error) return null;
  return (data ?? []) as unknown as RevisionRow[];
}
/**
 * Approvals that were claimed but could NOT be applied (the write to the stops or dates failed). The history is append-only, so such a claim
 * stays; a later "restore" row marks it ({failed: true, undo_of: <claim>}). A failed claim does not count as an answer to its proposal, as a
 * rival in a race, as the plan in force, or as something that can be undone.
 */
export const failedClaims = (log: RevisionRow[]): Set<number> => new Set(log.filter((r) => (r.meta as { failed?: boolean } | null)?.failed === true).map((r) => (r.meta as { undo_of?: number }).undo_of).filter((x): x is number => typeof x === "number"));
/** The revision the traveller is following now: the newest "original" or "approved" one (a proposal is never current until approved). */
export const currentRevision = (log: RevisionRow[]): number | null => log.find((r) => r.kind === "original" || r.kind === "approved")?.rev ?? null;

/** The plan as it stands now, kept as the original if no plan was ever kept (a trip planned by hand, first departing). */
export async function ensureOriginalRevision(supabase: SupabaseClient, tripId: string, userId: string, reason: string): Promise<void> {
  const have = await supabase.from("trip_plan_revisions").select("rev").eq("trip_id", tripId).limit(1);
  if (have.error || ((have.data as unknown[] | null)?.length ?? 0) > 0) return;
  const places = await supabase.from("places").select("id, name, day_number, sequence_order, arrival_time, drive_minutes, drive_km").eq("trip_id", tripId).order("day_number", { ascending: true }).order("sequence_order", { ascending: true });
  if (places.error) return;
  await recordRevision(supabase, tripId, userId, toSnapshot((places.data ?? []) as PlaceRow[]), reason);
}
