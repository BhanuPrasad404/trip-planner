// "On your way", the fetching half (lib/intake/journey.ts decides). Outside services are injected so tests use fakes.
import type { ExploreCategoryId } from "@/lib/explore/categories";
import type { ExploreItem } from "@/lib/explore/items";
import { classifyMapFailure } from "@/lib/explore/failure";
import { distanceKm } from "@/lib/geo";
import { DRIVE_MARGIN } from "./propose";
import { PROPOSE_WAIT_MS } from "./propose-service";
import { MAX_OFF_KM, drivingDaysOneWay, kindsForInterests, stopsAlongRoad, type JourneyAsk, type JourneyRoad, type JourneyStop } from "./journey";

export type JourneyDeps = {
  /** The road between two points. Never throws: it degrades to a straight line and says so (source "estimate"). */
  route: (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Promise<{ line: [number, number][]; km: number; minutes: number; source: string }>;
  /** Places within `radiusKm` of the road line, of these kinds (or all), asked in ONE question. Throws when the map servers can't be reached. */
  along: (line: [number, number][], radiusKm: number, kinds: readonly ExploreCategoryId[] | "all") => Promise<ExploreItem[]>;
};
export type JourneyAnswer = {
  status: "ok" | "none" | "unavailable" | "too_close";
  road: JourneyRoad | null;
  /** Days of driving one way at the daily limit, and the limit used. */
  drivingDays: number; dayLimitHours: number;
  stops: JourneyStop[];
  note: string | null;
  reason: string | null;
  hint: string | null;
};

/** Closer than this, there is no "way" worth planning stops on. */
export const MIN_JOURNEY_KM = 80;
const within = <T,>(p: Promise<T>, ms: number): Promise<T> => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error("slow")), ms); })]).finally(() => clearTimeout(t));
};
const hm = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`);

export async function proposeJourney(ask: JourneyAsk, deps: JourneyDeps, waitMs = PROPOSE_WAIT_MS): Promise<JourneyAnswer> {
  const dayLimitHours = ask.maxDriveHours ?? 7;
  const blank = { road: null, drivingDays: 0, dayLimitHours, stops: [] as JourneyStop[], reason: null, hint: null };
  if (distanceKm(ask.start, ask.dest) < MIN_JOURNEY_KM) return { ...blank, status: "too_close", note: null };

  const r = await within(deps.route(ask.start, ask.dest), 15_000).catch(() => null);
  if (!r || r.line.length < 2) return { ...blank, status: "unavailable", note: "We couldn't get the road between these places just now. Try again in a minute.", reason: "routing service did not answer", hint: "The road-routing service (OSRM) did not answer. The public demo server is for light testing: set OSRM_BASE_URL for launch." };
  const road: JourneyRoad = { km: Math.round(r.km), minutes: Math.round(r.minutes), source: r.source === "estimate" ? "estimate" : "road" };
  const days = drivingDaysOneWay(road, ask.maxDriveHours);

  const kinds = kindsForInterests(ask.interests);
  let items: ExploreItem[];
  try { items = await within(deps.along(r.line, MAX_OFF_KM, kinds.length ? kinds : "all"), waitMs); }
  catch (e) {
    const reason = (e instanceof Error ? e.message : "unknown").replace(/\s+/g, " ").slice(0, 300);
    console.error(`[journey] map lookup failed for ${ask.start.name} → ${ask.dest.name}: ${reason}`);
    const f = classifyMapFailure(reason);
    return { ...blank, status: "unavailable", road, drivingDays: days, note: f.note, reason, hint: f.hint };
  }
  const stops = stopsAlongRoad(items, r.line, road, ask);
  const drive = `${ask.start.name} to ${ask.dest.name} is about ${road.km} km, ${hm(Math.round(road.minutes * DRIVE_MARGIN))} of driving${road.source === "estimate" ? " (estimated: we couldn't get the real road)" : ""}`;
  const note = `${drive}. At ${dayLimitHours} hours a day that is about ${days} ${days === 1 ? "day" : "days"} of driving each way.`;
  if (stops.length === 0) return { status: "none", road, drivingDays: days, dayLimitHours, stops, note: `${note} We found no well-known places of this kind within ${MAX_OFF_KM} km of the road.`, reason: null, hint: null };
  return { status: "ok", road, drivingDays: days, dayLimitHours, stops, note, reason: null, hint: null };
}
