import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { z } from "zod";
import { movePlaceSchema, placeHoursSchema, placePrioritySchema, placeVisitSchema, relocatePlaceSchema, stopArrivalSchema, stopStatusSchema, uuid } from "@/lib/validation/schemas";
import { rateLimiter } from "@/lib/rate-limit";
import { validateHours } from "@/lib/server/opening-hours";
import { conflictMessage, decideArrival, decideStatusChange, eventTime } from "@/lib/trip/progress";
import { activeArrivalUsers, kindForProgress } from "@/lib/trip/journey";
import { loadArrivalEvents, recordEvent } from "@/lib/server/journey-events";
import { randomUUID } from "node:crypto";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid place id", 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  // RLS guarantees only trip members can delete; .select() tells us if anything matched (and where the stop sat in the day).
  const { data, error } = await supabase.from("places").delete().eq("id", id).select("id, trip_id, day_number, sequence_order");
  if (error) return dbError(error, "delete place");
  if (!data || data.length === 0) return jsonError("Place not found", 404);

  // The stop AFTER the deleted one kept "drive from the previous point" numbers measured from the deleted stop. That leg no longer
  // exists, so its saved km/minutes are cleared (shown as unknown / straight-line until the day is planned again), never reused.
  const gone = data[0] as { trip_id: string; day_number: number | null; sequence_order: number | null };
  if (gone.day_number !== null && gone.sequence_order !== null) {
    const { data: after, error: findError } = await supabase
      .from("places").select("id").eq("trip_id", gone.trip_id).eq("day_number", gone.day_number).gt("sequence_order", gone.sequence_order)
      .order("sequence_order", { ascending: true }).limit(1);
    const nextId = (after as { id: string }[] | null)?.[0]?.id;
    const { error: clearError } = findError || !nextId ? { error: findError } : await supabase.from("places").update({ drive_km: null, drive_minutes: null }).eq("id", nextId);
    if (clearError) console.error("[api] delete place: could not clear the next stop's old leg:", clearError.code, clearError.message);
  }

  return NextResponse.json({ ok: true, trip_id: gone.trip_id });
}

// STRICT on purpose: a request is EITHER a move OR a relocation. Mixed or unknown fields are rejected
// loudly instead of one half being silently dropped (and it blocks smuggling in columns like trip_id).
const patchSchema = z.union([movePlaceSchema.strict(), relocatePlaceSchema.strict(), stopStatusSchema.strict(), stopArrivalSchema.strict(), placePrioritySchema.strict(), placeVisitSchema.strict(), placeHoursSchema.strict()]);

// Either mark a stop done/skipped/planned (trip mode), move a stop to another day (day_number; null = back to Ideas),
// or relocate it when the pin is wrong (lat + lng, optionally a corrected name/address).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid place id", 400);

  const supabase = await createClient();
  // The sign-in check starts at once and overlaps with everything that does not depend on it (reading the body, looking the
  // place up). NOTHING is written until the Auth server has confirmed the person, exactly as before.
  const authP = supabase.auth.getUser();
  const parsed = await parseBody(req, patchSchema);
  const isMove = !parsed.error && !("priority" in parsed.data) && !("visit_minutes" in parsed.data) && !("status" in parsed.data) && !("arrived" in parsed.data) && !("lat" in parsed.data) && !("hours" in parsed.data);
  // Only a MOVE needs to know which trip the place belongs to; the other edits are a single UPDATE that tells us (through the
  // rows it changed) whether the place exists and is yours — a place you may not edit is invisible to you (Row Level Security).
  // Promise.resolve(...) STARTS the request now: a query builder is lazy and would otherwise wait until it is awaited.
  const findP = isMove ? Promise.resolve(supabase.from("places").select("id, trip_id").eq("id", id).maybeSingle()) : null;
  const {
    data: { user },
  } = await authP;
  if (!user) return jsonError("Please sign in", 401);
  if (parsed.error) return parsed.error;
  const input = parsed.data;

  if ("hours" in input) {
    if (!rateLimiter.take(`place-hours:${user.id}`, 60, 60_000)) return jsonError("Too many requests. Please slow down and try again shortly.", 429);
    // Read first (Row Level Security: a stop you can't see is "not found"); the coordinates matter for sunrise/sunset rules.
    const { data: row, error: readError } = await supabase.from("places").select("id, lat, lng, opening_hours, hours_source, hours_confirmed_at").eq("id", id).maybeSingle();
    if (readError) return dbError(readError, "hours: read");
    if (!row) return jsonError("Place not found", 404);
    const h = input.hours;
    let patch: Record<string, unknown>;
    let warnings: string[] = [];
    if ("confirm" in h) {
      if (!row.opening_hours) return jsonError("There are no opening hours on this stop to confirm.", 409);
      if (row.hours_source === "traveller" || row.hours_confirmed_at) return NextResponse.json({ ok: true, ...pickHours(row) });
      patch = { hours_confirmed_at: new Date().toISOString() }; // the database records who and when
    } else if (h.value === null) {
      patch = { opening_hours: null }; // the database clears source, reference and confirmation with it
    } else {
      const v = validateHours(h.value, { lat: row.lat, lng: row.lng });
      if (!v.ok) return jsonError(v.reason, 422);
      warnings = v.warnings;
      patch = { opening_hours: v.value, hours_source: "traveller", hours_ref: null, hours_fetched_at: null, hours_confirmed_at: new Date().toISOString() };
    }
    // Only change what we just read: if someone else changed the hours meanwhile, say so instead of confirming text nobody saw.
    let q = supabase.from("places").update(patch).eq("id", id);
    q = row.opening_hours === null ? q.is("opening_hours", null) : q.eq("opening_hours", row.opening_hours);
    const { data, error } = await q.select("id, opening_hours, hours_source, hours_ref, hours_fetched_at, hours_confirmed_at, hours_confirmed_by");
    if (error) return dbError(error, "hours: update");
    if (!data || data.length === 0) return jsonError("Someone else changed these opening hours just now. Reload and check them again.", 409);
    return NextResponse.json({ ok: true, ...pickHours(data[0]), warnings });
  }

  if ("visit_minutes" in input) {
    const { data, error } = await supabase.from("places").update({ visit_minutes: input.visit_minutes }).eq("id", id).select("id");
    if (error) return dbError(error, "visit_minutes: update");
    if (!data || data.length === 0) return jsonError("Place not found", 404);
    return NextResponse.json({ ok: true });
  }

  if ("priority" in input) {
    const { data, error } = await supabase.from("places").update({ priority: input.priority }).eq("id", id).select("id");
    if (error) return dbError(error, "priority: update");
    if (!data || data.length === 0) return jsonError("Place not found", 404);
    return NextResponse.json({ ok: true });
  }

  if ("status" in input || "arrived" in input) return progress(supabase, id, input, user.id);


  if ("lat" in input) {
    // A moved pin invalidates the old drive leg and arrival time; re-run Auto-plan to recompute them.
    const { data, error } = await supabase
      .from("places")
      .update({
        lat: input.lat,
        lng: input.lng,
        ...(input.name ? { name: input.name } : {}),
        address: input.address,
        drive_minutes: null,
        drive_km: null,
        arrival_time: null,
      })
      .eq("id", id)
      .select("id");
    if (error) return dbError(error, "relocate: update");
    if (!data || data.length === 0) return jsonError("Place not found", 404);
    // Hours suggested from map data belonged to the feature near the OLD pin: drop them. Hours a member typed stay.
    await supabase.from("places").update({ opening_hours: null }).eq("id", id).eq("hours_source", "map_data");
    return NextResponse.json({ ok: true });
  }

  const { data: current, error: findError } = await findP!;
  if (findError) return dbError(findError, "patch: find");
  if (!current) return jsonError("Place not found", 404);

  const q = supabase
    .from("places")
    .select("sequence_order")
    .eq("trip_id", current.trip_id)
    .order("sequence_order", { ascending: false, nullsFirst: false })
    .limit(1);
  const { data: last } = await (input.day_number === null ? q.is("day_number", null) : q.eq("day_number", input.day_number)).maybeSingle();

  // Moving invalidates the old plan details for this stop.
  const { error } = await supabase
    .from("places")
    .update({ day_number: input.day_number, sequence_order: (last?.sequence_order ?? 0) + 1, arrival_time: null, drive_minutes: null, drive_km: null, status: "planned", status_at: null })
    .eq("id", id);
  if (error) return dbError(error, "move: update");
  return NextResponse.json({ ok: true });
}

function pickHours(r: Record<string, unknown>) {
  return {
    opening_hours: (r.opening_hours as string | null) ?? null, hours_source: (r.hours_source as string | null) ?? null, hours_ref: (r.hours_ref as string | null) ?? null,
    hours_fetched_at: (r.hours_fetched_at as string | null) ?? null, hours_confirmed_at: (r.hours_confirmed_at as string | null) ?? null, hours_confirmed_by: (r.hours_confirmed_by as string | null) ?? null,
  };
}

// ── A stop's progress: when it really happened, never overwriting what has moved on (rules: lib/trip/progress.ts) ──
const RICH = "id, trip_id, name, status, status_at, arrived_at, status_event_id, arrived_event_id";
const LEGACY = "id, trip_id, name, status, status_at";
/** The progress columns of migration 20261101000000 are not in the database yet. */
const missingColumn = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204" || /column .* (does not exist|of relation)|schema cache/i.test(e.message ?? ""));
type Row = { id: string; trip_id?: string; name?: string; status?: string | null; status_at?: string | null; arrived_at?: string | null; status_event_id?: string | null; arrived_event_id?: string | null };

async function progress(supabase: Awaited<ReturnType<typeof createClient>>, id: string, input: z.infer<typeof stopStatusSchema> | z.infer<typeof stopArrivalSchema>, userId: string) {
  const t = eventTime(input.at, Date.now());
  if (!t.ok) return jsonError(t.error, 422);
  const recordedAt = new Date().toISOString();
  const clamped = t.clamped || undefined;
  /** Only when a write matched nothing do we look at the stop, to say WHY (not yours / already there / moved on). One write is the normal case. */
  const look = async (): Promise<{ row: Row | null; error: { code?: string; message?: string } | null }> => {
    let r = await supabase.from("places").select(RICH).eq("id", id).maybeSingle();
    if (r.error && missingColumn(r.error)) r = await supabase.from("places").select(LEGACY).eq("id", id).maybeSingle();
    return { row: (r.data as unknown as Row | null) ?? null, error: r.error };
  };
  /** The journey's history: one line for each change that really happened. Best effort: it never turns a saved change into a failure. */
  const log = async (changed: { id: string; trip_id?: string; name?: string } | undefined, kind: ReturnType<typeof kindForProgress>) => {
    if (!changed?.trip_id) return;
    // How an arrival was noticed (the phone's location, with how accurate it was, or the traveller's word). A stop's status is always the traveller's word.
    const evidence = "arrived" in input ? { source: input.source ?? "manual", accuracyM: input.accuracy_m ?? null } : { source: "manual" as const, accuracyM: null };
    try {
      const r = await recordEvent(supabase, { tripId: changed.trip_id, userId, kind, occurredAt: t.at, source: evidence.source, accuracyM: evidence.accuracyM, clientEventId: input.event_id ?? randomUUID(), placeId: changed.id, placeName: changed.name ?? null });
      if (!r.ok && !r.missing) console.error("[api] progress: event not recorded:", r.error?.code, r.error?.message);
    } catch (e) { console.error("[api] progress: event not recorded:", e); }
  };
  const conflict = (row: Row, wanted: "planned" | "done" | "skipped") => {
    const cur = (row.status === "done" || row.status === "skipped" ? row.status : "planned") as "planned" | "done" | "skipped";
    return NextResponse.json({ error: conflictMessage(cur, wanted), code: "conflict", current: { status: cur, status_at: row.status_at ?? null } }, { status: 409 });
  };

  if ("arrived" in input) {
    const { arrived } = input;
    // A place can have several people arrived at it, each at their own time. The place's own arrival time is the FIRST person's; a person
    // saying "not here yet" about themselves must not take someone else's arrival away from the place.
    if (!arrived) {
      const seen = await look();
      const row = seen.row;
      if (row?.trip_id) {
        const evs = await loadArrivalEvents(supabase, row.trip_id, id);
        const others = evs ? [...activeArrivalUsers(evs, id)].filter((u) => u !== userId) : [];
        if (others.length > 0) {
          await log(row, kindForProgress({ arrived: false }));
          return NextResponse.json({ ok: true, arrived_at: row.arrived_at ?? null, others: others.length, clamped });
        }
      }
    }
    const patch = { arrived_at: arrived ? t.at : null, arrived_event_id: input.event_id ?? null };
    // Arriving is recorded only for a stop still to be visited, and the FIRST arrival wins; "not here yet" clears it.
    let q = supabase.from("places").update(patch).eq("id", id);
    if (arrived) q = q.eq("status", "planned").is("arrived_at", null);
    const w = await q.select("id, trip_id, name");
    // The new columns are not in the database yet: say it was not stored (the screen still helps the traveller; nothing is invented).
    if (w.error) return missingColumn(w.error) ? NextResponse.json({ ok: true, stored: false }) : dbError(w.error, "arrival: update");
    if (w.data && w.data.length > 0) {
      await log(w.data[0] as { id: string; trip_id?: string; name?: string }, kindForProgress({ arrived }));
      return NextResponse.json({ ok: true, arrived_at: patch.arrived_at, clamped });
    }
    const { row, error } = await look();
    if (error) return dbError(error, "arrival: read");
    if (!row) return jsonError("Place not found", 404); // Row Level Security: a stop you may not edit is invisible to you
    const d = decideArrival(row, input);
    // Already arrived by someone else (the place has its arrival time): this person's own arrival is still theirs to record, once.
    if (arrived && d.kind === "unchanged" && row.arrived_at && (row.status ?? "planned") === "planned") {
      const evs = await loadArrivalEvents(supabase, row.trip_id ?? "", id);
      if (evs && !activeArrivalUsers(evs, id).has(userId)) await log(row, kindForProgress({ arrived: true }));
    }
    return NextResponse.json({ ok: true, ...(d.kind === "apply" ? { unchanged: true } : { [d.kind]: true }), arrived_at: row.arrived_at ?? null });
  }

  const legacyPatch = { status: input.status, status_at: input.status === "planned" ? null : t.at };
  const richPatch = { ...legacyPatch, status_event_id: input.event_id ?? null, status_recorded_at: recordedAt };
  // With `expected` the write is compare-and-set: it only happens if the stop is still as the sender saw it. A change that slipped in
  // (another device, an older queued change) matches nothing and is reported as a conflict, never an overwrite. Without `expected`
  // (an older app version) the write is as it always was.
  const write = (p: Record<string, unknown>) => {
    let q = supabase.from("places").update(p).eq("id", id);
    if (input.expected) q = q.eq("status", input.expected);
    return q.select("id, trip_id, name");
  };
  let w = await write(richPatch);
  if (w.error && missingColumn(w.error)) w = await write(legacyPatch);
  if (w.error) return dbError(w.error, "status: update");
  if (w.data && w.data.length > 0) {
    await log(w.data[0] as { id: string; trip_id?: string; name?: string }, kindForProgress({ status: input.status }));
    return NextResponse.json({ ok: true, status: input.status, clamped });
  }

  // No `expected` and nothing changed: the stop is not there for this person (Row Level Security), exactly as it always was.
  if (!input.expected) return jsonError("Place not found", 404);
  const { row, error } = await look();
  if (error) return dbError(error, "status: read");
  if (!row) return jsonError("Place not found", 404);
  const d = decideStatusChange(row, input);
  if (d.kind === "duplicate" || d.kind === "unchanged") return NextResponse.json({ ok: true, [d.kind]: true, status: row.status ?? "planned" });
  return conflict(row, input.status);
}
