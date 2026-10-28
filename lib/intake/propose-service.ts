// "Plan it for me", the fetching half (lib/intake/propose.ts decides). Outside services are injected so tests use fakes.
import type { ExploreItem } from "@/lib/explore/items";
import { estimateMatrix } from "@/lib/providers/estimate";
import { classifyMapFailure } from "@/lib/explore/failure";
import { distanceKm } from "@/lib/geo";
import { TRAVEL_DAY_HOURS } from "./journey";
import { DRIVE_MARGIN, SEARCH_RADIUS_KM, buildPlans, candidatesFor, type Ask, type Matrix, type ProposedPlan } from "./propose";

export type ProposeDeps = {
  /** Places round the hub (Explore's circle search, all kinds). Throws when the map servers can't be reached. */
  around: (hub: { lat: number; lng: number }, radiusKm: number) => Promise<ExploreItem[]>;
  /** Road times between points (index 0 = the hub). Throws when the routing service is down. */
  matrix: (points: { lat: number; lng: number }[]) => Promise<Matrix>;
};
export type Travel = { oneWayMin: number; /** Days of driving there and back at the traveller's daily limit. */ drivingDays: number; estimated: boolean };
export type ProposeAnswer = {
  plans: ProposedPlan[];
  /** How many days of sights the plans are made for: the trip's days minus the days spent just getting there and back. */
  sightDays: number;
  /** Set when the hub is far from where the trip starts. */
  travel: Travel | null;
  /** Why the map lookup failed (map server names and HTTP codes only, never a key): shown under "Details" so it can be fixed. */
  reason: string | null;
  /** What to do about it, for whoever runs the server. */
  hint: string | null;
  /** ok · none (nothing notable near the hub) · partial (road times estimated) · unavailable (map servers busy). */
  status: "ok" | "none" | "partial" | "unavailable";
  note: string | null;
  roadTimes: "road" | "estimate" | null;
};

/** The first look round a place the map has not been asked about yet can take a while on the free servers; this is how long we wait. */
export const PROPOSE_WAIT_MS = 40_000;
/** Closer than this, getting there is not worth a warning. */
const NEAR_KM = 60;

async function travelOf(ask: Ask, deps: ProposeDeps): Promise<Travel | null> {
  if (!ask.start || distanceKm(ask.start, ask.hub) < NEAR_KM) return null;
  let m: Matrix, estimated = false;
  try { m = await within(deps.matrix([ask.start, ask.hub]), 10_000); estimated = m.source === "estimate"; }
  catch { m = estimateMatrix([ask.start, ask.hub]); estimated = true; }
  const oneWayMin = Math.round((m.durations[0][1] / 60) * DRIVE_MARGIN);
  // A travel day is a long driving day (7 h unless the traveller said a limit). Each way is counted on its own: a 13-hour road is two days, not 1.9.
  const limitMin = (ask.maxDriveHours ?? TRAVEL_DAY_HOURS) * 60;
  const oneWayDays = Math.max(1, Math.ceil(oneWayMin / limitMin));
  return { oneWayMin, drivingDays: oneWayDays * (ask.roundTrip === false ? 1 : 2), estimated };
}

const within = <T,>(p: Promise<T>, ms: number): Promise<T> => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error("slow")), ms); })]).finally(() => clearTimeout(t));
};

const hm = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`);

export async function proposeTrip(ask: Ask, deps: ProposeDeps, waitMs = PROPOSE_WAIT_MS): Promise<ProposeAnswer> {
  const travel = await travelOf(ask, deps);
  const sightDays = Math.max(1, ask.days - (travel?.drivingDays ?? 0));
  const base = { sightDays, travel };
  let items: ExploreItem[];
  try { items = await within(deps.around(ask.hub, SEARCH_RADIUS_KM), waitMs); }
  catch (e) {
    const reason = (e instanceof Error ? e.message : "unknown").replace(/\s+/g, " ").slice(0, 300);
    console.error(`[propose] map lookup failed for ${ask.hub.name}: ${reason}`);
    const f = classifyMapFailure(reason);
    return { ...base, plans: [], status: "unavailable", reason, hint: f.hint, note: `${f.note} Or add places yourself below.`, roadTimes: null };
  }

  const cands = candidatesFor(items, ask);
  if (cands.length === 0) return { ...base, plans: [], status: "none", reason: null, hint: null, note: `We found no well-known places within ${SEARCH_RADIUS_KM} km of ${ask.hub.name} on the map. Add the places you want from the search below.`, roadTimes: null };

  let matrix: Matrix;
  let estimated = false;
  try { matrix = await within(deps.matrix([ask.hub, ...cands.map((c) => c.item)]), 15_000); estimated = matrix.source === "estimate"; }
  catch { matrix = estimateMatrix([ask.hub, ...cands.map((c) => c.item)]); estimated = true; }

  const plans = buildPlans(cands, matrix, { ...ask, days: sightDays });
  const longWay = travel && travel.drivingDays >= 1 && travel.oneWayMin >= 120
    ? `${ask.hub.name} is about ${hm(travel.oneWayMin)} from ${ask.start!.name} each way${travel.estimated ? " (estimated)" : ""}. Getting there${ask.roundTrip === false ? "" : " and back"} takes about ${travel.drivingDays} ${travel.drivingDays === 1 ? "day" : "days"} of driving, so these plans are for ${sightDays} ${sightDays === 1 ? "day" : "days"} of sights.${ask.days - travel.drivingDays < 1 ? " Your trip is too short for this place: add days, or pick somewhere nearer." : ""}`
    : null;
  const notes = [longWay, estimated ? "The road-time service didn't answer, so drive times are estimated (straight-line distance plus a road factor)." : null].filter((x): x is string => !!x);
  const empty = plans.every((p) => p.count === 0);
  if (empty) return { ...base, plans: [], status: "none", reason: null, hint: null, note: [`Everything we found near ${ask.hub.name} is further than a day's driving allows. Add places yourself below.`, ...notes].join(" "), roadTimes: estimated ? "estimate" : "road" };
  return { ...base, plans, status: estimated ? "partial" : "ok", reason: null, hint: null, note: notes.length ? notes.join(" ") : null, roadTimes: estimated ? "estimate" : "road" };
}
