// "What is worth a stop on MY trip?" The orchestration around the pure parts:
//   trip + stops (read under the person's own access) → what they are doing now (lib/explore/context.ts)
//   → the real road through the stops (routing service, kept for a few hours) → places in a corridor round that road (the shared
//   Explore cache / one map query) → ranked by how far off the road they are (lib/explore/route-rank.ts)
//   → the extra drive for the best few measured by road (lib/intel/detour.ts), or honestly left as an estimate.
// It never changes the trip. Every claim it returns is calculated here; what it cannot know it says it cannot.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExploreCategoryId } from "@/lib/explore/categories";
import { exploreContext, type ExploreContext } from "@/lib/explore/context";
import { detourText, rankAlongRoute, rankAround, type RoutedItem } from "@/lib/explore/route-rank";
import { decimateLine } from "@/lib/explore/route-scope";
import { matchDestinations, summarize, type DestinationRow, type PostStamp } from "@/lib/explore/community";
import { loadExplore, type Loaded, type LoadDeps } from "@/lib/explore/service";
import type { ExploreScope } from "@/lib/explore/query";
import { buildRoute, trimLine } from "@/lib/intel/route-geometry";
import { measureRoadDetours } from "@/lib/intel/detour";
import { routingProvider } from "@/lib/providers/registry";
import type { RoutingProvider } from "@/lib/providers/types";
import { todayISO as serverToday } from "@/lib/server/trip-data";

export type ExploreTripInput = { tripId: string; category: ExploreCategoryId | "all"; radiusKm: number; cursor: number; limit: number; position: { lat: number; lng: number } | null };

export type ExploreTripAnswer = {
  mode: ExploreContext["mode"];
  headline: string;
  notes: string[];
  items: RoutedItem[];
  nextCursor: number | null;
  total: number;
  /** Why the list is empty, in the app's own terms (null when there are results). */
  empty: null | "no_trip" | "no_data" | "none_in_corridor";
  route: { km: number; source: "road" | "estimate" } | null;
  remainingStops: number;
  coverage: { candidates: number; source: Loaded["source"]; stale: boolean; fetchedAt: string } | null;
};

export type ExploreTripDeps = { load?: (scope: ExploreScope, category: ExploreCategoryId | "all", deps: LoadDeps) => Promise<Loaded>; loadDeps: LoadDeps; routing?: Pick<RoutingProvider, "route" | "matrix">; today?: () => Promise<string> };

const MAX_CORRIDOR_KM = 700;
const MEASURE_TOP = 10;
const LINE_TTL_MS = 6 * 3_600_000;
const lineCache = new Map<string, { at: number; line: [number, number][]; source: "road" | "estimate" }>();
export const clearTripLineCache = () => lineCache.clear();

const q = (n: number, step: number) => (Math.round(n / step) * step).toFixed(3);

export async function exploreForTrip(supabase: SupabaseClient, input: ExploreTripInput, deps: ExploreTripDeps): Promise<ExploreTripAnswer | { error: "not_found" }> {
  const { data: trip, error } = await supabase.from("trips").select("*").eq("id", input.tripId).maybeSingle();
  if (error) throw new Error(`trip: ${error.message}`);
  if (!trip) return { error: "not_found" };                          // not a member (row-level security) looks the same as not existing
  const { data: places, error: pErr } = await supabase.from("places").select("id, name, lat, lng, day_number, sequence_order, status").eq("trip_id", input.tripId).limit(300);
  if (pErr) throw new Error(`places: ${pErr.message}`);

  const today = await (deps.today ?? serverToday)();
  const ctx = exploreContext({ trip, places: places ?? [], todayISO: today, position: input.position });
  const base = { mode: ctx.mode, headline: ctx.headline, notes: [...ctx.notes], remainingStops: ctx.remaining.length };
  const none = (empty: ExploreTripAnswer["empty"]): ExploreTripAnswer => ({ ...base, items: [], nextCursor: null, total: 0, empty, route: null, coverage: null });
  if (ctx.mode === "none") return none("no_trip");

  const load = deps.load ?? loadExplore;
  let items: RoutedItem[];
  let loaded: Loaded;
  let route: ExploreTripAnswer["route"] = null;

  if (ctx.anchors.length >= 2) {
    const road = await roadThrough(ctx, deps.routing ?? routingProvider());
    const line = trimLine(road.line, MAX_CORRIDOR_KM * 1000);
    route = { km: Math.round(buildRoute(line).totalM / 1000), source: road.source };
    if (road.source === "estimate") base.notes.push("We couldn't get the road for this route just now, so the search follows straight lines between your stops. Distances off the route are approximate.");
    loaded = await load({ kind: "route", line: decimateLine(line), radius_km: input.radiusKm }, input.category, deps.loadDeps);
    items = rankAlongRoute(loaded.items, line, ctx, { maxOffKm: input.radiusKm, limit: input.limit });
    await measureTop(items, line, deps.routing ?? routingProvider(), input.cursor);
  } else if (ctx.focus) {
    const radius = Math.min(30, input.radiusKm * 2);
    loaded = await load({ kind: "point", lat: ctx.focus.lat, lng: ctx.focus.lng, radius_km: radius }, input.category, deps.loadDeps);
    items = rankAround(loaded.items, ctx.focus, { maxOffKm: radius, limit: input.limit });
  } else return none("no_trip");

  const page = items.slice(input.cursor, input.cursor + input.limit);
  await attachCommunity(supabase, page, Date.now());
  const next = input.cursor + input.limit;
  const empty = items.length > 0 ? null : loaded.items.length === 0 ? "no_data" : "none_in_corridor";
  if (loaded.stale) base.notes.push("The map servers are busy, so this list is from an earlier visit.");
  if (page.some((i) => i.detour?.basis === "estimate" && i.offKm > 1)) base.notes.push("“Extra drive” is an estimate from the distance off your route, unless it says “by road”.");
  return { ...base, items: page, nextCursor: next < items.length ? next : null, total: items.length, empty, route, coverage: { candidates: loaded.items.length, source: loaded.source, stale: loaded.stale, fetchedAt: new Date(loaded.fetchedAt).toISOString() } };
}

/** The real road through the anchors, kept a few hours (the same road for the same stops). The routing service never throws: it degrades to a straight line and says so. */
async function roadThrough(ctx: ExploreContext, routing: Pick<RoutingProvider, "route">): Promise<{ line: [number, number][]; source: "road" | "estimate" }> {
  // A moving position would make every request a new road: it counts as the same place within about 2 km.
  const key = ctx.anchors.map((a, i) => (ctx.mode === "active" && i === 0 ? `${q(a.lat, 0.02)},${q(a.lng, 0.02)}` : `${a.lat.toFixed(3)},${a.lng.toFixed(3)}`)).join("|");
  const hit = lineCache.get(key);
  if (hit && Date.now() - hit.at < LINE_TTL_MS) return hit;
  const r = await routing.route(ctx.anchors.map((a) => ({ lat: a.lat, lng: a.lng })));
  const out = { at: Date.now(), line: r.line, source: r.source === "estimate" ? ("estimate" as const) : ("road" as const) };
  if (out.line.length >= 2) { if (lineCache.size >= 200) lineCache.delete(lineCache.keys().next().value as string); lineCache.set(key, out); }
  return out;
}

/** Replaces the estimated extra drive with the real one (by road) for the first page's off-route places. One routing request for all of them. */
async function measureTop(items: RoutedItem[], line: [number, number][], routing: Pick<RoutingProvider, "matrix">, cursor: number): Promise<void> {
  const slice = items.slice(cursor, cursor + MEASURE_TOP).filter((i) => i.offKm > 1 && i.aheadKm !== null);
  if (slice.length === 0) return;
  const measured = await measureRoadDetours(slice.map((i) => ({ key: i.id, lat: i.lat, lng: i.lng, alongM: (i.aheadKm as number) * 1000 })), buildRoute(line), (pts) => routing.matrix(pts));
  for (const it of slice) {
    const m = measured[it.id];
    if (!m) continue;
    it.detour = { km: m.km, min: Math.round(m.min), basis: "road" };
    it.reasons[0] = detourText(it.detour, it.offKm);
  }
}

/**
 * The traveller feed for the places on this page: the destination that is really the same place, and how many posts (that this person may
 * see) it has and how fresh they are. Best effort: if the feed can't be read, the places still show, with no report line.
 */
export async function attachCommunity(db: SupabaseClient, page: RoutedItem[], nowMs: number): Promise<void> {
  for (const it of page) it.community = null;
  if (page.length === 0) return;
  try {
    const ids = new Set<string>();
    for (let i = 0; i < page.length; i += 12) {             // the database function takes at most 12 points at a time
      const chunk = page.slice(i, i + 12);
      const { data, error } = await db.rpc("destinations_near_points", { _lats: chunk.map((x) => x.lat), _lngs: chunk.map((x) => x.lng), _radius_km: 2 });
      if (error) throw new Error(error.message);
      for (const id of (data ?? []) as unknown[]) if (typeof id === "string") ids.add(id);
    }
    if (ids.size === 0) return;
    const list = [...ids].slice(0, 100);
    const [{ data: dests, error: dErr }, { data: posts, error: pErr }] = await Promise.all([
      db.from("destinations").select("id, name, lat, lng").in("id", list).limit(100),
      // Only what this person may see (row-level security), visible and approved, newest first.
      db.from("posts").select("destination_id, created_at, captured_at").in("destination_id", list).eq("status", "visible").eq("moderation", "approved").order("created_at", { ascending: false }).limit(500),
    ]);
    if (dErr || pErr) throw new Error((dErr ?? pErr)!.message);
    const match = matchDestinations(page, (dests ?? []) as DestinationRow[]);
    for (const it of page) { const d = match.get(it.id); if (d) it.community = summarize(d, (posts ?? []) as PostStamp[], nowMs); }
  } catch (e) {
    console.warn("[explore] traveller reports unavailable:", e instanceof Error ? e.message : e);
  }
}
