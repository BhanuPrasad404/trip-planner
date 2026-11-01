// SERVER ONLY. Turning a trip into the input of the replan PROPOSAL (lib/trip/replan-proposal.ts), keeping a proposal as a revision, and
// applying an APPROVED one. Nothing here changes the itinerary except `applyProposal`, which the decide route calls after the traveller
// said yes to one stored proposal.
import type { SupabaseClient } from "@supabase/supabase-js";
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { sunsetAt } from "@/lib/engine/daylight";
import { parseISODate } from "@/lib/dates";
import { getMatrix } from "@/lib/routing";
import { elevationProvider, weatherProvider } from "@/lib/providers/registry";
import { areaOf, forecastHorizonMs } from "@/lib/forecast/areas";
import { momentAt } from "@/lib/forecast/moment";
import { SEVERITY_RANK, WEATHER_SOURCE } from "@/lib/weather-rules";
import { isHillPair } from "@/lib/engine/margin";
import type { WeatherState } from "@/lib/trip/conditions";
import { hoursStatusAt } from "@/lib/server/opening-hours";
import { commitmentsSignature, loadCommitments } from "@/lib/server/commitments";
import { deriveJourney, type JourneyState } from "@/lib/trip/journey";
import { loadRevisions, currentRevision, rowToEvent, EVENT_COLUMNS, type EventRow, type SnapshotRow } from "@/lib/server/journey-events";
import { INDIA_UTC_OFFSET_MIN, clockToMinutes, localToUtcMs } from "@/lib/travel/clock";
import { isResumed, isClosed } from "@/lib/trip/lifecycle";
import { PACE_WINDOW, type Pace } from "@/lib/trip/preferences";
import { scheduleSignature, type OpenState, type PStop, type Pt, type Priority, type Proposal, type ReplanInput } from "@/lib/trip/replan-proposal";

export const MAX_REPLAN_STOPS = 40;
/** Places where the weather matters little (a rain-proof visit). Everything else counts as outdoors. */
const INDOOR = new Set(["museum", "food", "stay"]);

/** Weather for the stops at a trip day and minute, from the provider's forecast. Pure answers: unavailable or beyond the forecast are said, not filled in. */
async function weatherFor(stops: PlaceRow[], startDate: string, off: number): Promise<ReplanInput["weather"]> {
  const now = Date.now();
  const horizon = forecastHorizonMs(now);
  const byArea = new Map<string, ReturnType<typeof areaOf>>();
  for (const p of stops) { const a = areaOf(p); byArea.set(a.key, a); }
  let got: Record<string, { steps: import("@/lib/providers/types").ForecastStep[]; fetchedAt: number } | null> = {};
  try { got = await weatherProvider().areaForecasts([...byArea.values()], now - 6 * 3_600_000, horizon); } catch { got = {}; }
  const byId = new Map(stops.map((p) => [p.id, p]));
  return (id, day, minute): WeatherState => {
    const p = byId.get(id);
    const date = dateOfDay(startDate, day);
    if (!p || !date) return { status: "unavailable" };
    const m = Math.max(0, Math.min(1439, Math.round(minute)));
    const ms = localToUtcMs(date, `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, off);
    if (ms === null) return { status: "unavailable" };
    const area = got[areaOf(p).key];
    const moment = momentAt(area ?? null, p, ms, now, horizon, off);
    if (moment.status === "beyond-forecast") return { status: "beyond-forecast" };
    if (moment.status !== "ok") return { status: "unavailable" };
    const worst = [...moment.hazards].sort((a, b) => SEVERITY_RANK[b.level] - SEVERITY_RANK[a.level])[0];
    return { status: "ok", level: worst ? worst.level : "none", label: worst?.label ?? null, detail: worst?.detail ?? null, fetchedAt: moment.fetchedAt, source: WEATHER_SOURCE };
  };
}

export type PlaceRow = {
  id: string; name: string; lat: number; lng: number; category: string | null; day_number: number | null; sequence_order: number | null;
  arrival_time: string | null; status: "planned" | "done" | "skipped" | null; status_at: string | null; priority?: Priority | null; visit_minutes?: number | null;
  opening_hours?: string | null; hours_source?: string | null; hours_confirmed_at?: string | null; drive_minutes: number | null; drive_km: number | null;
};
type TripRow = { owner_id?: string | null; vehicle_range_km?: number | null; id: string; num_days: number; start_date: string | null; start_lat: number | null; start_lng: number | null; start_city: string | null; start_time?: string | null };

export type ReplanRequest = {
  local_date: string; local_time: string; night_driving?: boolean; lat?: number; lng?: number;
  keep?: string[]; drop?: string[]; pins?: Record<string, number>;
  /** What the traveller says is in the tank (percent). */
  fuel_percent?: number;
  /** How fast the traveller likes a day to move (their own choice). */
  pace?: Pace;
};
export type Loaded = {
  ok: true; input: ReplanInput; places: PlaceRow[]; trip: TripRow; baseRev: number | null; signature: string; commitSig: string; /** This person owns the trip: only they may approve. */ isOwner: boolean;
  /** The traveller's own ask (not a guess): the situation. */
  hint: { journey: JourneyState };
};
export type LoadFailure = { ok: false; status: number; error: string };

const PLACE_COLS = "id, name, lat, lng, category, day_number, sequence_order, arrival_time, status, status_at, priority, visit_minutes, opening_hours, hours_source, hours_confirmed_at, drive_minutes, drive_km";
const dateOfDay = (startDate: string, day: number): string | null => {
  const d = parseISODate(startDate);
  if (!d) return null;
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + day - 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
};
/** Which trip day a calendar date is, even before the trip or after its end (a resumed or late trip). null with no start date. */
export function rawTripDay(startDate: string | null, localDate: string): number | null {
  const a = startDate ? parseISODate(startDate) : null, b = parseISODate(localDate);
  return a && b ? Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1 : null;
}

export async function loadReplanInput(supabase: SupabaseClient, tripId: string, userId: string, req: ReplanRequest, opts: { needRevisions?: boolean } = {}): Promise<Loaded | LoadFailure> {
  const tripR = await supabase.from("trips").select("id, owner_id, num_days, start_date, start_lat, start_lng, start_city").eq("id", tripId).maybeSingle();
  if (tripR.error) return { ok: false, status: 500, error: "Couldn't load the trip." };
  if (!tripR.data) return { ok: false, status: 404, error: "Trip not found" };
  const trip = tripR.data as TripRow;
  // Lifecycle apart from the trip, so this works where those columns are missing.
  const lc = await supabase.from("trips").select("resumed_at, closed_at, resume_day_end_min").eq("id", tripId).maybeSingle();
  const life = lc.error ? null : (lc.data as { resumed_at?: string | null; closed_at?: string | null; resume_day_end_min?: number | null } | null);
  if (isClosed({ closed_at: life?.closed_at })) return { ok: false, status: 422, error: "This trip was finished or called off. Reopen it before changing its plan." };

  // The vehicle's range is read apart, so this works where that column is missing (then range is simply not assessed).
  const vr = await supabase.from("trips").select("vehicle_range_km").eq("id", tripId).maybeSingle();
  if (!vr.error && vr.data) trip.vehicle_range_km = (vr.data as { vehicle_range_km?: number | null }).vehicle_range_km ?? null;

  const placesR = await supabase.from("places").select(PLACE_COLS).eq("trip_id", tripId);
  if (placesR.error) return { ok: false, status: 500, error: "Couldn't load the places." };
  const places = (placesR.data ?? []) as unknown as PlaceRow[];
  const open = places.filter((p) => (p.status ?? "planned") === "planned" && p.day_number !== null);
  if (open.length === 0) return { ok: false, status: 422, error: "Nothing is left to plan: every stop is done, skipped, or still only an idea." };
  if (open.length > MAX_REPLAN_STOPS) return { ok: false, status: 422, error: `This works for up to ${MAX_REPLAN_STOPS} stops still to do. Move some back to your ideas first.` };

  const revisions = opts.needRevisions === false ? [] : await loadRevisions(supabase, tripId);
  if (revisions === null) return { ok: false, status: 503, error: "Plan changes need a database update that hasn't been applied yet, so they can't be saved right now. Nothing was changed." };
  const baseRev = currentRevision(revisions);

  // Where the journey is, from the traveller's own events. Without the history, "has anything happened?" is the stops.
  let journey: JourneyState = places.some((p) => p.status === "done" || p.status === "skipped") ? "travelling" : "awaiting-departure";
  let anyEvents = false;
  const ev = await supabase.from("trip_events").select(EVENT_COLUMNS).eq("trip_id", tripId).eq("user_id", userId).order("occurred_at", { ascending: true }).limit(1000);
  if (!ev.error) {
    const events = ((ev.data ?? []) as EventRow[]).map(rowToEvent).filter((e) => e !== null);
    anyEvents = events.length > 0;
    if (anyEvents) journey = deriveJourney(events).state;
  }
  const notStarted = !places.some((p) => p.status === "done" || p.status === "skipped") && journey === "awaiting-departure" && !anyEvents;

  // Today: the day it falls on (before the start or after the end are real answers: a missed or resumed trip), else the first day with work.
  const raw = rawTripDay(trip.start_date, req.local_date);
  const firstOpenDay = Math.min(...open.map((p) => p.day_number as number));
  const resumed = !!life && isResumed({ resumed_at: life.resumed_at, closed_at: life.closed_at });
  const nowDay = resumed ? Math.max(raw ?? firstOpenDay, firstOpenDay) : raw ?? firstOpenDay;
  const nowMin = clockToMinutes(req.local_time);

  // Where from: the position the traveller gave (this request only, never stored), else the last stop they finished, else the planned start.
  let origin: Pt | null = null;
  if (req.lat !== undefined && req.lng !== undefined) origin = { lat: req.lat, lng: req.lng, name: "your location" };
  else {
    const lastDone = places.filter((p) => p.status === "done" && p.status_at).sort((a, b) => (b.status_at ?? "").localeCompare(a.status_at ?? ""))[0];
    if (lastDone) origin = { lat: lastDone.lat, lng: lastDone.lng, name: lastDone.name };
    else if (trip.start_lat != null && trip.start_lng != null) origin = { lat: trip.start_lat, lng: trip.start_lng, name: trip.start_city ?? "the start" };
  }
  if (!origin) return { ok: false, status: 422, error: "We don't know where you are or where the trip starts. Allow location access, or set a start point for this trip." };

  const matrix = await getMatrix([origin, ...open.map((p) => ({ lat: p.lat, lng: p.lng }))]);
  const index = new Map<string, number>();
  index.set(`${origin.lat},${origin.lng}`, 0);
  open.forEach((p, i) => { const k = `${p.lat},${p.lng}`; if (!index.has(k)) index.set(k, i + 1); });
  const estimatedAll = matrix.source === "estimate";
  const drive: ReplanInput["drive"] = (a, b) => {
    const i = index.get(`${a.lat},${a.lng}`), j = index.get(`${b.lat},${b.lng}`);
    if (i === undefined || j === undefined || i === j) return { min: 0, km: 0, estimated: false };
    return { min: matrix.durations[i][j] / 60, km: matrix.distances[i][j] / 1000, estimated: estimatedAll || (matrix.estimatedPairs ?? 0) > 0 };
  };

  const byId = new Map(open.map((p) => [p.id, p]));
  const commitments = await loadCommitments(supabase, tripId);
  const stops: PStop[] = places.map((p) => ({
    id: p.id, name: p.name, lat: p.lat, lng: p.lng, day: p.day_number, order: p.sequence_order, arrivalTime: p.arrival_time, status: (p.status ?? "planned") as PStop["status"],
    visitMin: p.visit_minutes ?? Math.round(CATEGORIES[normalizeCategory(p.category)].hours * 60), priority: (p.priority ?? "normal") as Priority,
    commitment: commitments.get(p.id) ?? null, driveMin: p.drive_minutes, driveKm: p.drive_km, outdoor: !INDOOR.has(normalizeCategory(p.category)),
  }));

  const startDate = trip.start_date;
  const off = INDIA_UTC_OFFSET_MIN;
  const open_: ReplanInput["open"] = startDate ? (id, day, minute): OpenState => {
    const p = byId.get(id);
    const date = dateOfDay(startDate, day);
    if (!p?.opening_hours || !date) return { state: "unknown" };
    const m = Math.max(0, Math.min(1439, Math.round(minute)));
    const clock = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const ms = localToUtcMs(date, clock, off);
    if (ms === null) return { state: "unknown" };
    const st = hoursStatusAt(p.opening_hours, ms, off, { lat: p.lat, lng: p.lng });
    const at = st.at && /^\d{2}:\d{2}$/.test(st.at) ? clockToMinutes(st.at) : null;
    // Hours a person typed or confirmed are facts; hours only read from map data are a doubt until someone confirms them.
    const confirmed = p.hours_source === "traveller" || !!p.hours_confirmed_at;
    const meta = { confidence: confirmed ? ("confirmed" as const) : ("unconfirmed" as const), source: confirmed ? "Hours confirmed on your trip" : "OpenStreetMap, not confirmed" };
    return st.state === "closed" ? { state: "closed", opensAtMin: at, ...meta } : st.state === "open" ? { state: "open", closesAtMin: at, ...meta } : { state: "unknown" };
  } : undefined;
  const sunset: ReplanInput["sunset"] = startDate ? (pt, day) => sunsetAt(pt, startDate, day, off) : undefined;

  // Hills: heights of the points (free, ≤100 per request). Unknown heights never mark a hill road (no guess).
  const pts = [origin, ...open.map((p) => ({ lat: p.lat, lng: p.lng }))];
  const heights = pts.length <= 100 ? await elevationProvider().elevations(pts).catch(() => null) : null;
  const hill: ReplanInput["hill"] = heights ? (a, b) => { const i = index.get(`${a.lat},${a.lng}`), j = index.get(`${b.lat},${b.lng}`); return i !== undefined && j !== undefined && isHillPair(heights[i], heights[j]); } : undefined;

  // Weather: the forecast of the areas the stops are in, as far as it reaches. A stop with no forecast is "not checked", never "fine".
  const weather = startDate ? await weatherFor(open, startDate, off) : undefined;

  const input: ReplanInput = {
    stops, numDays: trip.num_days, nowDay, nowMin, origin, journey, drive, open: open_, sunset,
    prefs: { dayStartMin: PACE_WINDOW[req.pace ?? "balanced"].dayStartMin, dayEndMin: resumed && life?.resume_day_end_min != null ? life.resume_day_end_min : PACE_WINDOW[req.pace ?? "balanced"].dayEndMin, nightDriving: !!req.night_driving, bufferMin: 10 },
    keepIds: req.keep, dropIds: req.drop, pinDays: req.pins, startDate, notStarted,
    weather, hill,
    vehicle: trip.vehicle_range_km ? { rangeKm: trip.vehicle_range_km, fuelPct: req.fuel_percent ?? null } : null,
    // Alternatives are only the traveller's OWN saved ideas that are indoors: nothing is invented.
    ideas: places.filter((p) => p.day_number === null && (p.status ?? "planned") === "planned").map((p) => ({ id: p.id, name: p.name, indoor: INDOOR.has(normalizeCategory(p.category)) })),
  };
  return { ok: true, input, places, trip, baseRev, isOwner: trip.owner_id === userId, commitSig: commitmentsSignature(commitments), signature: scheduleSignature(places.map((p) => ({ id: p.id, day: p.day_number, order: p.sequence_order, status: p.status }))), hint: { journey } };
}

/** The whole schedule as it would stand if `proposal` were approved. Stops it does not mention stay exactly as they are. */
export function snapshotWith(places: PlaceRow[], proposal: Proposal): SnapshotRow[] {
  const placed = new Map(proposal.days.flatMap((d) => d.stops.map((s) => [s.id, s] as const)));
  const removed = new Set(proposal.removals.map((r) => r.id));
  return places.map((p) => {
    const s = placed.get(p.id);
    if (s) return { id: p.id, name: p.name, day: s.day, order: s.order, arrival_time: `${String(Math.floor(s.arriveMin / 60) % 24).padStart(2, "0")}:${String(Math.round(s.arriveMin) % 60).padStart(2, "0")}`, drive_minutes: s.driveMin, drive_km: s.driveKm };
    if (removed.has(p.id)) return { id: p.id, name: p.name, day: null, order: null, arrival_time: null, drive_minutes: null, drive_km: null };
    return { id: p.id, name: p.name, day: p.day_number, order: p.sequence_order, arrival_time: p.arrival_time, drive_minutes: p.drive_minutes, drive_km: p.drive_km };
  });
}

/** What a stored proposal keeps about itself: enough to show it again and to answer it, bounded. */
export function proposalMeta(proposal: Proposal, baseRev: number | null, signature: string, commitSig?: string): Record<string, unknown> {
  return {
    strategy: proposal.strategy, label: proposal.label, base_rev: baseRev, signature, ...(commitSig !== undefined ? { commit_sig: commitSig } : {}), feasible: proposal.feasible, summary: proposal.summary.slice(0, 1200),
    changes: proposal.changes.filter((c) => c.kind !== "unchanged").slice(0, 60).map((c) => ({ ...c, reason: c.reason.slice(0, 300) })),
    conditions: proposal.conditions.slice(0, 30).map((c) => ({ ...c, detail: c.detail.slice(0, 400), recommendation: c.recommendation?.slice(0, 300) ?? null })), limitations: proposal.limitations,
    removals: proposal.removals.slice(0, 40), atRisk: proposal.atRisk.slice(0, 40), bookingConflicts: proposal.bookingConflicts.slice(0, 20), night: proposal.night, dates: proposal.dates,
    unresolved: proposal.unresolved.slice(0, 10).map((u) => u.slice(0, 300)),
  };
}
