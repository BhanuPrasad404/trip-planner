// "If I add this place as a stop on Day N, what happens?" Reads the trip with the person's own access, asks the routing service ONCE
// for the road times between where that day's driving starts, the stops still to do, and the new place, then lib/explore/plan-effect.ts
// works out the best spot, the extra time, the later stops' new times and what can (and can't) be checked. Writes nothing.
import type { SupabaseClient } from "@supabase/supabase-js";
import { CATEGORIES } from "@/lib/categories";
import { plannerCategory } from "@/lib/explore/glyph";
import type { ExploreCategoryId } from "@/lib/explore/categories";
import { planEffect, type PlanEffect } from "@/lib/explore/plan-effect";
import { sunsetAt } from "@/lib/engine/daylight";
import { tripDayISO } from "@/lib/forecast/ist";
import { distanceKm } from "@/lib/geo";
import { routingProvider } from "@/lib/providers/registry";
import type { RoutingProvider } from "@/lib/providers/types";
import { tripDatesView } from "@/lib/trip/passed";
import { liveDayFor, tripLength } from "@/lib/trip-state";
import { todayISO as serverToday } from "@/lib/server/trip-data";

export type EffectInput = { tripId: string; day: number | null; place: { name: string; lat: number; lng: number; category: ExploreCategoryId | null } };
export type EffectAnswer = { day: number; days: number; dayDate: string | null; effect: PlanEffect };

type Row = { id: string; name: string; lat: number; lng: number; day_number: number | null; sequence_order: number | null; status: string | null; arrival_time: string | null; opening_hours?: string | null };
const ord = (a: Row, b: Row) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0);

export async function previewAddStop(db: SupabaseClient, input: EffectInput, deps: { routing?: Pick<RoutingProvider, "matrix">; today?: () => Promise<string> } = {}): Promise<EffectAnswer | { error: "not_found" }> {
  const { data: trip, error } = await db.from("trips").select("*").eq("id", input.tripId).maybeSingle();
  if (error) throw new Error(`trip: ${error.message}`);
  if (!trip) return { error: "not_found" };
  const { data: rows, error: pErr } = await db.from("places").select("id, name, lat, lng, day_number, sequence_order, status, arrival_time, opening_hours").eq("trip_id", input.tripId).limit(300);
  if (pErr) throw new Error(`places: ${pErr.message}`);
  const places = ((rows ?? []) as Row[]).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  const today = await (deps.today ?? serverToday)();
  const days = tripLength(trip.num_days);
  const view = tripDatesView(trip, today);
  const running = !!trip.resumed_at || liveDayFor(trip, today).mode === "today";
  const day = Math.min(days, Math.max(1, input.day ?? suggestDay(trip, today, places, input.place, running)));

  const ofDay = places.filter((p) => p.day_number === day).sort(ord);
  const remaining = ofDay.filter((p) => (p.status ?? "planned") === "planned");
  const finished = ofDay.filter((p) => p.status === "done" || p.status === "skipped");
  const earlier = places.filter((p) => p.day_number !== null && p.day_number < day).sort((a, b) => (a.day_number! - b.day_number!) || ord(a, b));
  const from = finished[finished.length - 1] ?? earlier[earlier.length - 1]
    ?? (Number.isFinite(trip.start_lat) && Number.isFinite(trip.start_lng) && trip.start_lat !== null ? { lat: trip.start_lat as number, lng: trip.start_lng as number } : null)
    ?? remaining[0] ?? input.place;

  const pts = [{ lat: from.lat, lng: from.lng }, ...remaining.map((p) => ({ lat: p.lat, lng: p.lng })), { lat: input.place.lat, lng: input.place.lng }];
  const m = await (deps.routing ?? routingProvider()).matrix(pts);
  // Dates over and not resumed: the old day's hours and sunset mean nothing. Resumed: it is today.
  const dayDate = view.passed ? (running ? today : null) : tripDayISO(trip.start_date, day);
  const last = remaining[remaining.length - 1] ?? input.place;
  const sunset = dayDate ? sunsetAt(last, dayDate, 1) : null;
  const cat = input.place.category ? plannerCategory(input.place.category) : "other";
  const visitMin = Math.max(15, Math.round((CATEGORIES[cat]?.hours ?? 1) * 60 / 5) * 5);

  const effect = planEffect({
    stops: remaining.map((p) => ({ id: p.id, name: p.name, arrival_time: p.arrival_time, opening_hours: p.opening_hours ?? null })),
    candidateName: input.place.name, durations: m.durations, basis: m.source === "estimate" ? "estimate" : "road",
    visitMin, dayISO: dayDate, sunsetMin: sunset,
  });
  return { day, days, dayDate, effect };
}

/** The day to suggest: today's trip day while travelling; otherwise the day of the nearest planned stop; otherwise Day 1. */
function suggestDay(trip: { start_date: string | null; num_days: number }, today: string, places: Row[], p: { lat: number; lng: number }, running: boolean): number {
  if (running) { const d = liveDayFor(trip, today); if (d.mode === "today" && d.day) return d.day; }
  let best: { d: number; km: number } | null = null;
  for (const s of places) if (s.day_number !== null) { const km = distanceKm(s, p); if (!best || km < best.km) best = { d: s.day_number, km }; }
  return best?.d ?? 1;
}
