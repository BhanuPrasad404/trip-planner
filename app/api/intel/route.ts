import { after } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { communityBoost, type ReportLite } from "@/lib/intel/community";
import { poiOwnPhoto, type PoiPhoto } from "@/lib/intel/poi-media";
import { measureRoadDetours, shortlistForDetour } from "@/lib/intel/detour";
import { buildIntel } from "@/lib/intel/engine";
import { poiKey } from "@/lib/intel/ranking";
import { pointAt, buildRoute, trimLine } from "@/lib/intel/route-geometry";
import type { TripType, WeatherSample } from "@/lib/intel/types";
import { getPoiService } from "@/lib/poi";
import { runBackground } from "@/lib/poi/background";
import { groupsOfKinds, POI_KINDS, type PoiKind } from "@/lib/poi/types";
import { eventsProvider, routingProvider, trafficProvider, weatherProvider } from "@/lib/providers/registry";
import { INDIA_UTC_OFFSET_MIN } from "@/lib/travel/clock";
import { areaOf } from "@/lib/forecast/areas";
import type { RouteLeg } from "@/lib/providers/types";
import { consumeQuota } from "@/lib/quota";
import { intelSchema } from "@/lib/validation/schemas";

export const maxDuration = 30;

const HORIZON_M = 150_000; // we map and search the nearest 150 km of the road ahead
const BUFFER_KM = 3; // places within 3 km of the road are candidates
const KINDS = POI_KINDS.filter((k): k is PoiKind => k !== "parking"); // parking is only useful at a destination
const NO_STOPS_LOOKAHEAD_M = 60_000;
const WX_ROAD_STEP_M = 50_000;
const MAX_ROAD_WX_POINTS = 3;
/** Two days of hours: a stop reached tomorrow evening still has its forecast. */
const WX_HOURS = 48;
/**
 * Time budgets. The places, weather and road-detour lookups all depend on public servers; when one is slow, the whole request used to outlive
 * the platform's 30 s limit and the phone only saw "Couldn't get suggestions right now". Now each step gets a share of the time, and an
 * answer always comes back in time: with what we have, and a plain note about what is still loading.
 */
const PLACES_BUDGET_MS = 11_000;
const WEATHER_BUDGET_MS = 7_000;
const DETOUR_BUDGET_MS = 6_000;
const TIMED_OUT = Symbol("timed out");
async function within<T>(ms: number, work: Promise<T>): Promise<T | typeof TIMED_OUT> {
  work.catch(() => undefined); // if it fails after we stopped waiting, nobody is listening: that is not an error
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}

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

  // Weather where you are and at EVERY stop runs alongside the road and places lookups; the points along the road ahead are added
  // once the road is known (below). Points in the same ~10 km forecast cell share one forecast (and one cached call).
  // The SAME forecast as the weather panel: areas of ~10 km (lib/forecast/areas.ts), true timing, cached per area and day, never over
  // 60 minutes old (the provider's areaForecasts). Each area becomes one sample; lib/intel/forecast.ts reads it with the panel's rules.
  const fetchWeather = async (points: { lat: number; lng: number }[]): Promise<WeatherSample[]> => {
    const areas = [...new Map(points.map((p) => { const a = areaOf(p); return [a.key, a] as const; })).values()];
    if (areas.length === 0) return [];
    const got = await weatherProvider().areaForecasts(areas, nowMs - 3_600_000, nowMs + WX_HOURS * 3_600_000).catch(() => ({} as Record<string, null>));
    return areas.flatMap((a) => { const f = got[a.key]; return f ? [{ lat: f.lat, lng: f.lng, steps: f.steps, fetchedAt: f.fetchedAt }] : []; });
  };
  const asked = new Set<string>();
  const newCells = (points: { lat: number; lng: number }[]) => points.filter((p) => { const k = areaOf(p).key; if (asked.has(k)) return false; asked.add(k); return true; });
  const weatherPromise = timed("weather", fetchWeather(newCells([position, ...input.stops])));

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

  // Weather along the road ahead: a point every 50 km of the next 150 km (rain, storm or fog on the way, not only at the stops).
  const roadPoints: { lat: number; lng: number }[] = [];
  for (let m = WX_ROAD_STEP_M; m <= Math.min(full.totalM, HORIZON_M); m += WX_ROAD_STEP_M) roadPoints.push(pointAt(full, m));
  const roadWeatherPromise = timed("weather-road", fetchWeather(newCells(roadPoints).slice(0, MAX_ROAD_WX_POINTS)));

  // 2. Our own places database: make sure the corridor is covered, then query it.
  const poiService = getPoiService();
  const groups = groupsOfKinds(KINDS);
  let coverage = { total: 0, ready: 0, pending: 0, failed: 0 };
  let pois: Awaited<ReturnType<typeof poiService.corridor>> = [];
  const placesStart = performance.now();
  try {
    const cov = await within(PLACES_BUDGET_MS, poiService.ensureCoverage(ahead, BUFFER_KM, groups, { syncBudget: 2 }));
    if (cov === TIMED_OUT) {
      // The map servers are slow: answer with the places we already have, and say the rest is still loading (the app asks again shortly).
      coverage = { total: 1, ready: 0, pending: 1, failed: 0 };
      notes.push("Places along your road are still loading, so suggestions may be incomplete for now. They will fill in shortly.");
    } else {
      coverage = { total: cov.total, ready: cov.ready, pending: cov.pending.length, failed: cov.failed };
      if (cov.pending.length > 0) {
        const run = () => runBackground(cov.pending);
        try { after(run); } catch { void run(); } // outside a request scope (tests) just run it
      }
    }
    pois = await poiService.corridor(ahead, BUFFER_KM * 1000, KINDS, 800);
  } catch (e) {
    console.error("[intel] places unavailable:", e instanceof Error ? e.message : e);
    notes.push("Our places data is unavailable right now.");
  }
  timings.places = Math.round(performance.now() - placesStart);

  // 3. Weather (already running; hourly forecasts are cached per ~10 km cell and shared between requests).
  // Weather is best-effort: a slow forecast server must not cost the whole answer.
  const [wxHere, wxRoad] = await Promise.all([within(WEATHER_BUDGET_MS, weatherPromise), within(WEATHER_BUDGET_MS, roadWeatherPromise)]);
  if (wxHere === TIMED_OUT || wxRoad === TIMED_OUT) notes.push("The weather forecast is slow to load right now, so weather is left out of these suggestions.");
  const weather: WeatherSample[] = [...(wxHere === TIMED_OUT ? [] : wxHere), ...(wxRoad === TIMED_OUT ? [] : wxRoad)];

  // 4. Fresh community updates near the candidates (best-effort; used ONLY as a ranking signal — never as a picture of a place).
  let reports: ReportLite[] = [];
  if (pois.length > 0) {
    const lats = pois.map((p) => p.lat), lngs = pois.map((p) => p.lng);
    const since = new Date(nowMs - 60 * 86_400_000).toISOString();
    const { data } = await supabase
      .from("place_reports")
      .select("lat, lng, created_at")
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
    // An India-only product: every clock is India time, whatever time zone the phone is set to.
    utcOffsetMin: INDIA_UTC_OFFSET_MIN,
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
    // Real road detours sharpen the order of the few places we show; the quick estimates already stand if the road service is slow.
    const roadDetours = await within(DETOUR_BUDGET_MS, timed("detour", measureRoadDetours(candidates, full, (pts) => routingProvider().matrix(pts))));
    if (roadDetours !== TIMED_OUT && Object.keys(roadDetours).length > 0) result = buildIntel({ ...intelInput, roadDetours });
  }
  result.notes.push(...notes);

  // Photos: ONLY a place's own photo (its Wikimedia tag in our POI table). Traveler/destination uploads are never reused
  // here — being close to a place doesn't make a photo a photo of that place. No own photo → the UI shows the category icon.
  const poiByKey = new Map(pois.map((p) => [poiKey(p), p]));
  const shownKeys = new Set<string>();
  for (const s of result.smartStops) for (const o of s.options) shownKeys.add(o.key);
  for (const list of Object.values(result.aheadByKind)) for (const o of list ?? []) shownKeys.add(o.key);
  const photos: Record<string, PoiPhoto> = {};
  for (const key of shownKeys) {
    const own = poiOwnPhoto(poiByKey.get(key) ?? {});
    if (own) photos[key] = own;
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
