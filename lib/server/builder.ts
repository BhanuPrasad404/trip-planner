// Loads everything the Smart Trip Builder needs for one trip (places, votes, road matrix, weather) and runs the pure planner.
// Used by both the preview route and the apply route, so the traveller applies EXACTLY what they were shown (checked by signature).
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCategory } from "@/lib/categories";
import { dateOfTripDay } from "@/lib/dates";
import { computeGoScore } from "@/lib/goscore";
import { weatherProvider } from "@/lib/providers/registry";
import { getMatrix } from "@/lib/routing";
import { getSeasonStatus } from "@/lib/season";
import { summarizeVotes } from "@/lib/votes";
import { BUILDER_VERSION, MAX_BUILDER_PLACES, buildTrip, type BuilderInput, type BuilderPlace, type BuilderResult, type Priority, type StyleId } from "@/lib/trip-builder";
import type { EndMode } from "@/lib/trip-builder/types";

export type BuilderLoad =
  | { ok: true; input: BuilderInput; result: BuilderResult; signature: string; unscheduledIds: string[] }
  | { ok: false; status: number; error: string };

type Row = Record<string, unknown>;
const tagOf = (p: Row) => {
  const t = p.season_tags as { category?: string | null; good_months?: number[] } | { category?: string | null; good_months?: number[] }[] | null;
  return Array.isArray(t) ? t[0] : t ?? undefined;
};

/** Stable fingerprint of the INPUT (not the answer): places, dates, ends. If anything changes, an old preview must not be applied. */
export function inputSignature(input: BuilderInput): string {
  const stable = {
    v: BUILDER_VERSION, n: input.numDays, d: input.startDateISO, e: input.endMode, s: [input.start.lat, input.start.lng], x: input.end ? [input.end.lat, input.end.lng] : null,
    p: input.places.map((p) => [p.id, p.lat, p.lng, p.category, p.priority, p.visitMin ?? null, p.hours ?? null, p.vote ?? 0]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export async function loadBuilder(supabase: SupabaseClient, tripId: string, opts: { endMode: EndMode; styles?: StyleId[]; todayISO: string; userId: string; utcOffsetMin?: number }): Promise<BuilderLoad> {
  const { data: trip, error: tripError } = await supabase.from("trips").select("id, num_days, start_date, start_lat, start_lng, start_city, dest_lat, dest_lng, dest_name").eq("id", tripId).maybeSingle();
  if (tripError) return { ok: false, status: 500, error: "Couldn't load the trip." };
  if (!trip) return { ok: false, status: 404, error: "Trip not found" };
  if (trip.start_lat == null || trip.start_lng == null) return { ok: false, status: 422, error: "Set a starting point for this trip first." };

  const { data: rows, error: placesError } = await supabase.from("places").select("*, season_tags(category, good_months)").eq("trip_id", tripId);
  if (placesError) return { ok: false, status: 500, error: "Couldn't load the places." };
  const all = (rows ?? []) as Row[];
  if (all.some((p) => p.status === "done" || p.status === "skipped")) {
    return { ok: false, status: 409, error: "This trip is already under way. Use “Re-plan from now” on the Live page so finished stops stay as they are." };
  }
  const places = all;
  if (places.length > MAX_BUILDER_PLACES) return { ok: false, status: 422, error: `The builder handles up to ${MAX_BUILDER_PLACES} places at a time. Move some back to a later trip.` };

  const end = opts.endMode === "point" && trip.dest_lat != null && trip.dest_lng != null ? { lat: trip.dest_lat as number, lng: trip.dest_lng as number, label: (trip.dest_name as string) ?? "Destination" } : null;
  const endMode: EndMode = opts.endMode === "point" && !end ? "free" : opts.endMode;

  // group votes → a gentle nudge when something has to be dropped
  const { data: voteRows } = await supabase.from("place_votes").select("place_id, user_id, vote").eq("trip_id", tripId);
  const votes = summarizeVotes((voteRows ?? []) as { place_id: string; user_id: string; vote: -1 | 1 }[], opts.userId);

  const numDays = Math.max(1, Math.floor(trip.num_days as number));
  const startDate = (trip.start_date as string | null) ?? null;
  const base: BuilderPlace[] = places.map((p) => {
    const tag = tagOf(p);
    return {
      id: p.id as string, name: p.name as string, lat: p.lat as number, lng: p.lng as number,
      category: normalizeCategory((p.category as string | null) ?? tag?.category),
      priority: ((p.priority as Priority | undefined) ?? "normal"),
      visitMin: (p.visit_minutes as number | null | undefined) ?? null,
      hours: null, // we only plan around opening hours we actually KNOW; user-added places have none
      vote: votes[p.id as string]?.score ?? 0,
    };
  });

  // Weather per place per trip day (forecast when near, typical climate otherwise). Skipped for very large requests.
  if (startDate && base.length * numDays <= 120) {
    const requests: { id: string; lat: number; lng: number; date: Date }[] = [];
    for (const p of base) for (let d = 1; d <= numDays; d++) { const date = dateOfTripDay(startDate, d); if (date) requests.push({ id: `${p.id}|${d}`, lat: p.lat, lng: p.lng, date }); }
    const cond = await weatherProvider().conditionsFor(requests, opts.todayISO).catch(() => ({}));
    for (const [i, p] of base.entries()) {
      const tag = tagOf(places[i]);
      p.fit = []; p.fitNote = [];
      for (let d = 1; d <= numDays; d++) {
        const c = (cond as Record<string, import("@/lib/weather").Conditions>)[`${p.id}|${d}`] ?? null;
        const date = dateOfTripDay(startDate, d);
        const g = c && date ? computeGoScore({ category: p.category, seasonStatus: getSeasonStatus(tag?.good_months, date.getMonth() + 1), conditions: c }) : null;
        p.fit.push(g ? g.score : null);
        p.fitNote.push(c ? `${Math.round(c.tempMaxC)}°C, ~${c.precipMmPerDay < 1 ? "<1" : Math.round(c.precipMmPerDay)} mm rain` : null);
      }
    }
  }

  const start = { lat: trip.start_lat as number, lng: trip.start_lng as number, label: (trip.start_city as string) ?? "Start" };
  const matrix = await getMatrix([start, ...base, ...(end && endMode === "point" ? [end] : [])]);
  const input: BuilderInput = { places: base, start, end, endMode, numDays, startDateISO: startDate, utcOffsetMin: opts.utcOffsetMin ?? 330, matrix };
  const result = buildTrip(input, opts.styles);
  return { ok: true, input, result, signature: inputSignature(input), unscheduledIds: places.filter((p) => p.day_number == null).map((p) => p.id as string) };
}
