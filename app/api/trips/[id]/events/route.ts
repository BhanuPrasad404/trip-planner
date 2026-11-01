import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { EVENT_COLUMNS, ensureOriginalRevision, recordEvent, rowToEvent, tableMissing, type EventRow } from "@/lib/server/journey-events";
import { correctionError, correctionOf, eventError, type JourneyEvent } from "@/lib/trip/journey";
import { eventTime } from "@/lib/trip/progress";
import { journeyEventSchema, uuid } from "@/lib/validation/schemas";

const MAX_EVENTS = 1000;
/** The journey's history is not there yet (migration 20261102000000 not applied): said plainly, nothing is invented. */
const NOT_STORED = { ok: true, stored: false } as const;

/** The trip's journey history, oldest first. Members only (Row Level Security: a trip you are not on returns nothing). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const { data, error } = await supabase.from("trip_events").select(EVENT_COLUMNS).eq("trip_id", id).order("occurred_at", { ascending: true }).order("recorded_at", { ascending: true }).limit(MAX_EVENTS);
  if (error) return tableMissing(error) ? NextResponse.json({ ok: true, stored: false, events: [] }) : dbError(error, "events: list");
  // The name of the place you set off from (an approximate home) is yours: other people on the trip see that you left, and when, not where from.
  const events = ((data ?? []) as EventRow[]).map(rowToEvent).filter((e) => e !== null).map((e) => (e.userId === user.id || !e.meta || !("from" in e.meta) ? e : { ...e, meta: Object.fromEntries(Object.entries(e.meta).filter(([k]) => k !== "from")) }));
  return NextResponse.json({ ok: true, stored: true, events });
}

/**
 * Record one real event: the traveller left, paused, rested, arrived, finished a visit... It is judged where it belongs in TIME (an
 * offline "paused" is checked against the journey as it was then, not as it is now), and the same `client_event_id` twice is one event.
 * Events that do not fit the journey (a second "departed" while on the road) are refused with 409 and the reason; nothing is rewritten:
 * a mistake is fixed by a new event.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const supabase = await createClient();
  const authP = supabase.auth.getUser();
  const parsed = await parseBody(req, journeyEventSchema);
  const { data: { user } } = await authP;
  if (!user) return jsonError("Please sign in", 401);
  if (parsed.error) return parsed.error;
  if (!rateLimiter.take(`trip-events:${user.id}`, 120, 60_000)) return jsonError("Too many requests. Please slow down and try again shortly.", 429);
  const input = parsed.data;

  const t = eventTime(input.at, Date.now());
  if (!t.ok) return jsonError(t.error, 422);

  // The trip (is it yours to write to, and is it finished?) and the journey so far, together. Finished is read apart so this keeps
  // working where the lifecycle columns are missing.
  const tripP = Promise.resolve(supabase.from("trips").select("id, closed_at").eq("id", id).maybeSingle());
  const eventsP = Promise.resolve(supabase.from("trip_events").select(EVENT_COLUMNS).eq("trip_id", id).order("occurred_at", { ascending: true }).limit(MAX_EVENTS));
  const [firstTrip, existing] = await Promise.all([tripP, eventsP]);
  let trip = firstTrip;
  if (trip.error) trip = await Promise.resolve(supabase.from("trips").select("id").eq("id", id).maybeSingle()) as typeof trip;
  if (trip.error) return dbError(trip.error, "events: find trip");
  if (!trip.data) return jsonError("Trip not found", 404);
  if (existing.error) return tableMissing(existing.error) ? NextResponse.json(NOT_STORED) : dbError(existing.error, "events: read");

  const rows = (existing.data ?? []) as EventRow[];
  if (rows.some((r) => r.client_event_id === input.client_event_id)) return NextResponse.json({ ok: true, duplicate: true });
  const closed = typeof (trip.data as { closed_at?: string | null }).closed_at === "string";
  const journeyKinds = ["departed", "paused", "resumed", "rest_started", "rest_ended"];
  if (closed && journeyKinds.includes(input.kind)) return NextResponse.json({ error: "This trip was finished or called off. Reopen it to record more of the journey.", code: "closed" }, { status: 409 });

  // The plan's audit trail is written by the app when the owner decides: a decision cannot be sent in as an event, and a suggestion is only
  // accepted for a proposal that really exists on this trip. (The database policy enforces the same for direct writes.)
  if (input.kind === "revision_approved" || input.kind === "revision_rejected") return NextResponse.json({ error: "Decisions about the shared plan are recorded when the trip owner decides, not sent in directly.", code: "not-allowed" }, { status: 403 });
  if (input.kind === "revision_proposed") {
    const rev = input.meta.rev;
    if (input.meta.suggested !== true || typeof rev !== "number") return NextResponse.json({ error: "A suggestion must say which proposed change it is about.", code: "invalid-suggestion" }, { status: 422 });
    const found = await supabase.from("trip_plan_revisions").select("rev, kind").eq("trip_id", id).eq("rev", rev).maybeSingle();
    if (found.error) return tableMissing(found.error) ? NextResponse.json(NOT_STORED) : dbError(found.error, "events: suggestion");
    if (!found.data || (found.data as { kind: string }).kind !== "proposed") return NextResponse.json({ error: "That proposed change wasn't found.", code: "invalid-suggestion" }, { status: 404 });
  }

  // Only the person's OWN journey is judged (everyone on the trip has their own pauses and rests).
  const mine = rows.filter((r) => r.user_id === user.id).map(rowToEvent).filter((e) => e !== null);
  const why = eventError(mine, { kind: input.kind, occurredAt: t.at });
  if (why) return NextResponse.json({ error: why, code: "invalid-transition" }, { status: 409 });

  // A correction points at one of the person's OWN events and must leave their journey in order. It is added to the history; nothing is rewritten.
  if (input.kind === "manual_correction" && input.meta.target !== undefined) {
    const as = { kind: input.kind, meta: input.meta } as JourneyEvent;
    const c = correctionOf(as);
    if (!c) return NextResponse.json({ error: "A correction needs to say whether the event didn't happen (void) or what its real time was (retime).", code: "invalid-correction" }, { status: 422 });
    const bad = correctionError(mine, c, Date.now());
    if (bad) return NextResponse.json({ error: bad, code: "invalid-correction" }, { status: 409 });
  }

  const result = await recordEvent(supabase, {
    tripId: id, userId: user.id, kind: input.kind, occurredAt: t.at, source: input.source, clientEventId: input.client_event_id,
    placeId: input.place_id ?? null, placeName: input.place_name ?? null, accuracyM: input.accuracy_m ?? null, meta: input.meta,
  });
  if (!result.ok) return result.missing ? NextResponse.json(NOT_STORED) : dbError(result.error ?? {}, "events: record");
  // Leaving is the moment the plan being followed becomes history. A plan built by hand was never kept, so keep it now.
  if (input.kind === "departed" && !result.duplicate) await ensureOriginalRevision(supabase, id, user.id, "Kept when the journey began");
  return NextResponse.json({ ok: true, duplicate: result.duplicate || undefined, clamped: t.clamped || undefined });
}
