import { after } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { communityBoost, communityPhotoPath, type ReportLite } from "@/lib/intel/community";
import { measureRoadDetours, shortlistForDetour } from "@/lib/intel/detour";
import { buildIntel } from "@/lib/intel/engine";
import { pointAt, buildRoute, trimLine } from "@/lib/intel/route-geometry";
import type { TripType, WeatherSample } from "@/lib/intel/types";
import { getPoiService } from "@/lib/poi";
import { runBackground } from "@/lib/poi/background";
import { groupsOfKinds, POI_KINDS, type PoiKind } from "@/lib/poi/types";
import { eventsProvider, routingProvider, trafficProvider, weatherProvider } from "@/lib/providers/registry";
import type { RouteLeg } from "@/lib/providers/types";
import { consumeQuota } from "@/lib/quota";
import { REPORT_PHOTO_BUCKET } from "@/lib/reports";
import { intelSchema } from "@/lib/validation/schemas";

export const maxDuration = 30;

const HORIZON_M = 150_000; // we map and search the nearest 150 km of the road ahead
const BUFFER_KM = 3; // places within 3 km of the road are candidates
const KINDS = POI_KINDS.filter((k): k is PoiKind => k !== "parking"); // parking is only useful at a destination
const NO_STOPS_LOOKAHEAD_M = 60_000;

// Trip Intelligence: where you are + the road ahead + what's near it + weather + who you're travelling as
// → Smart Stops and "what should I do next?". Places come from OUR database (filled tile by tile), never per request from a public map server.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, intelSchema);
  if (bodyError) return bodyError;

  // Membership check + personalisation come from the database (RLS), never from the request body.
  const { data: trip, error: tripError } = await supabase.from("trips").select("id, trip_type, vehicle_range_km").eq("id", input.trip_id).maybeSingle();
  if (tripError) return dbError(tripError, "intel: load trip");
  if (!trip) return jsonError("Trip not found", 404);

  if (!(await consumeQuota(supabase, "intel", 800))) return jsonError("You've used today's smart suggestions. They reset within 24 hours.", 429);

  const nowMs = Date.now();
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const timed = async <T,>(name: string, work: Promise<T>): Promise<T> => {
    const t = performance.now();
    try { return await work; } finally { timings[name] = Math.round(performance.now() - t); }
  };
  const position = input.position;
  const notes: string[] = [];

  // Weather only needs where you are and where you are going — not the road or the places — so it runs ALONGSIDE them.
  const wxPoints = [position, ...(input.stops[0] ? [input.stops[0]] : []), ...(input.stops.length > 1 ? [input.stops[input.stops.length - 1]] : [])];
  const unique = wxPoints.filter((p, i) => wxPoints.findIndex((q) => Math.abs(q.lat - p.lat) < 0.1 && Math.abs(q.lng - p.lng) < 0.1) === i);
  const weatherPromise = timed("weather", Promise.all(unique.map(async (p) => ({ lat: p.lat, lng: p.lng, hours: await weatherProvider().hourly({ lat: p.lat, lng: p.lng }, 18).catch(() => []) }))));

  // 1. The road ahead.
  let line = input.route?.line ?? null;
  let legs: RouteLeg[] = input.route?.legs ?? [];
  if (!line || legs.length !== input.stops.length) {
    if (input.stops.length > 0) {
      const r = await timed("route", routingProvider().route([position, ...input.stops.map((s) => ({ lat: s.lat, lng: s.lng }))]));
      line = r.line;
      legs = r.legs;
      if (r.source === "estimate") notes.push("Routing is unavailable, so distances are straight-line estimates.");
    } else if (input.heading !== null) {
      // Free driving: no destination yet, so look along the direction of travel.
      const rad = (input.heading * Math.PI) / 180;
      const dLat = (Math.cos(rad) * NO_STOPS_LOOKAHEAD_M) / 111_000;
      const dLng = (Math.sin(rad) * NO_STOPS_LOOKAHEAD_M) / (111_000 * Math.max(0.2, Math.cos((position.lat * Math.PI) / 180)));
      line = [[position.lng, position.lat], [position.lng + dLng, position.lat + dLat]];
      legs = [];
      notes.push("No stops planned, so we're looking along your direction of travel.");
    }
  }
  if (!line || line.length < 2) {
    void weatherPromise.catch(() => undefined);
    return NextResponse.json({ result: null, coverage: null, photos: {}, notes: ["Add a stop to the day, or start moving, and we'll look at the road ahead."] });
  }

  const full = buildRoute(line);
  const ahead = trimLine(line, HORIZON_M);
  const mappedKm = Math.min(full.totalM, HORIZON_M) / 1000;

  // 2. Our own places database: make sure the corridor is covered, then query it.
  const poiService = getPoiService();
  const groups = groupsOfKinds(KINDS);
  let coverage = { total: 0, ready: 0, pending: 0, failed: 0 };
  let pois: Awaited<ReturnType<typeof poiService.corridor>> = [];
  const placesStart = performance.now();
  try {
    const cov = await poiService.ensureCoverage(ahead, BUFFER_KM, groups, { syncBudget: 2 });
    coverage = { total: cov.total, ready: cov.ready, pending: cov.pending.length, failed: cov.failed };
    if (cov.pending.length > 0) {
      const run = () => runBackground(cov.pending);
      try { after(run); } catch { void run(); } // outside a request scope (tests) just run it
    }
    pois = await poiService.corridor(ahead, BUFFER_KM * 1000, KINDS, 800);
  } catch (e) {
    console.error("[intel] places unavailable:", e instanceof Error ? e.message : e);
    notes.push("Our places data is unavailable right now.");
  }
  timings.places = Math.round(performance.now() - placesStart);

  // 3. Weather (already running; hourly forecasts are cached per ~10 km cell and shared between requests).
  const weather: WeatherSample[] = (await weatherPromise).filter((w) => w.hours.length > 0);

  // 4. Fresh community updates near the candidates (best-effort; makes good places rank higher and gives them real photos).
  let reports: ReportLite[] = [];
  if (pois.length > 0) {
    const lats = pois.map((p) => p.lat), lngs = pois.map((p) => p.lng);
    const since = new Date(nowMs - 60 * 86_400_000).toISOString();
    const { data } = await supabase
      .from("place_reports")
      .select("lat, lng, photo_path, created_at")
      .gte("created_at", since)
      .gte("lat", Math.min(...lats) - 0.004).lte("lat", Math.max(...lats) + 0.004)
      .gte("lng", Math.min(...lngs) - 0.004).lte("lng", Math.max(...lngs) + 0.004)
      .order("created_at", { ascending: false })
      .limit(400);
    reports = (data ?? []) as ReportLite[];
  }

  // 5. Think — first with quick estimates, then re-think the few places we are about to show using real road detours.
  const intelInput = {
    nowMs,
    utcOffsetMin: input.utc_offset_min,
    position,
    heading: input.heading,
    speedKmh: input.speed_kmh,
    route: { line, legs },
    stops: input.stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, plannedArrival: s.planned_arrival, visitMin: s.visit_min, value: s.value, valueNote: s.value_note, outdoor: s.outdoor })),
    pois,
    prefs: { tripType: trip.trip_type as TripType, vehicleRangeKm: trip.vehicle_range_km },
    weather,
    dayEndMin: input.day_end_min,
    coverageComplete: coverage.total > 0 && coverage.ready === coverage.total,
    mappedKm,
    boost: communityBoost(pois, reports, nowMs),
    comparePlan: input.compare_plan,
    drivingMin: input.driving_min,
    canMoveNextDay: input.can_move_next_day,
  };
  let result = buildIntel(intelInput);
  const candidates = shortlistForDetour(result);
  if (candidates.length > 0) {
    const roadDetours = await timed("detour", measureRoadDetours(candidates, full, (pts) => routingProvider().matrix(pts)));
    if (Object.keys(roadDetours).length > 0) result = buildIntel({ ...intelInput, roadDetours });
  }
  result.notes.push(...notes);

  // Real photos for the places we're about to show.
  const shown = new Map<string, { lat: number; lng: number }>();
  for (const s of result.smartStops) for (const o of s.options) shown.set(o.key, o);
  for (const list of Object.values(result.aheadByKind)) for (const o of list ?? []) shown.set(o.key, o);
  const photos: Record<string, string> = {};
  for (const [key, p] of shown) {
    const path = communityPhotoPath(p, reports);
    if (path) photos[key] = supabase.storage.from(REPORT_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  timings.total = Math.round(performance.now() - t0);
  const body = {
    result,
    coverage,
    photos,
    source: { places: poiService.store.id, routing: input.route ? "client" : "server" },
    // What we are NOT able to tell you (no real source connected). The UI says so instead of inventing conditions.
    capabilities: { traffic: trafficProvider().available, events: eventsProvider().available },
    // The road line itself is NOT sent back: the app already has it (it sent it, or got it from /api/eta).
    route: { km: Math.round((full.totalM / 1000) * 10) / 10, points: ahead.length },
    userPoint: pointAt(full, 0),
    timings,
  };
  // Server-Timing shows up in the browser's Network tab — "why was this slow?" has an answer.
  return NextResponse.json(body, { headers: { "Server-Timing": Object.entries(timings).map(([k, v]) => `${k};dur=${v}`).join(", ") } });
}
