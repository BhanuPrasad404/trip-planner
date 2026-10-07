import type { RouteLeg, HourlyWeather } from "@/lib/providers/types";
import type { LngLat, PoiKind, PoiRecord } from "@/lib/poi/types";
import type { OpenStatus } from "./hours";

export const TRIP_TYPES = ["friends", "family", "couple", "solo", "biker", "backpacker"] as const;
export type TripType = (typeof TRIP_TYPES)[number];
export const TRIP_TYPE_LABEL: Record<TripType, string> = {
  friends: "Friends", family: "Family", couple: "Couple", solo: "Solo", biker: "Biker / rider", backpacker: "Backpacker",
};

export type Prefs = { tripType: TripType; vehicleRangeKm: number };

/** An itinerary stop the person still intends to visit. */
export type StopInput = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  plannedArrival: string | null; // "HH:MM"
  visitMin: number;
  /** 0 (weak) … 2 (strong): from votes + Go Score. Used to decide what to skip when time runs short. */
  value: number;
  valueNote: string | null;
  /** Rain/dark matter for this stop (viewpoint, trek, fort…) — false for museums, food, stays. */
  outdoor: boolean;
};

export type WeatherSample = { lat: number; lng: number; hours: HourlyWeather[] };

export type IntelInput = {
  /** Detours measured with the routing service (key → extra km / minutes). Optional: without it detours are estimated. */
  roadDetours?: Record<string, { km: number; min: number }>;
  nowMs: number;
  utcOffsetMin: number;
  position: { lat: number; lng: number };
  heading: number | null;
  speedKmh: number | null;
  route: { line: LngLat[]; legs: RouteLeg[] };
  stops: StopInput[];
  pois: PoiRecord[];
  prefs: Prefs;
  weather: WeatherSample[];
  /** Local minute of the day by which the day should be finished (default 20:00). */
  dayEndMin: number;
  /** True when every map tile along the mapped part of the route has been ingested; "no fuel found" is only claimed then. */
  coverageComplete: boolean;
  /** How many km of the route ahead our places data covers (we only map the nearest part of a long route). */
  mappedKm?: number;
  /** Per place key ("source|source_id"): 0..1 bonus for fresh community updates/photos. */
  boost: Record<string, number>;
  /** True only when the route is for TODAY, so "behind plan" is meaningful. */
  comparePlan: boolean;
  /** Minutes of continuous driving so far (resets after a real stop). Null when unknown / not driving. */
  drivingMin?: number | null;
  /** Is there a later day a stop could be moved to? */
  canMoveNextDay?: boolean;
};

export type RankedPoi = {
  key: string;
  kind: PoiKind;
  name: string;
  lat: number;
  lng: number;
  brand: string | null;
  hours: string | null;
  alongM: number;
  offsetM: number;
  aheadKm: number;
  detourMin: number;
  /** Extra kilometres to leave the road, visit and rejoin — only when measured by road. */
  detourKm?: number | null;
  /** "road": measured with the routing service. "estimate": from the sideways distance. "none": on the road. */
  detourBasis?: "road" | "estimate" | "none";
  etaMin: number; // minutes from now
  arriveClock: string;
  open: OpenStatus;
  score: number; // 0..100
  reasons: string[];
  tags: Record<string, string>;
  /** When our map data for this place was last fetched (for trust labels). */
  fetchedAt: string;
};

export type Urgency = "now" | "soon" | "later";
export type SmartStopType = "fuel" | "meal" | "break" | "stay" | "sunset" | "detour";

export type SmartStop = {
  id: string;
  type: SmartStopType;
  title: string;
  reason: string;
  urgency: Urgency;
  options: RankedPoi[];
};

export type AdviceAction =
  | { type: "replan" }
  | { type: "skip"; stopId: string }
  | { type: "move_next_day"; stopId: string }
  /** "Go there": add this place as the next stop (always undoable). */
  | { type: "insert_stop"; key: string }
  | { type: "poi"; key: string };

export type Advice = {
  id: string;
  kind: SmartStopType | "late" | "behind" | "skip" | "weather" | "daylight";
  priority: number; // 0..100, higher = show first
  urgency: Urgency;
  title: string;
  detail: string;
  action?: AdviceAction;
  options?: RankedPoi[];
  /** The facts behind the suggestion, for "Why?" — numbers, not vibes. */
  why?: string[];
};

export type StopEta = { id: string; name: string; etaClock: string; delayMin: number | null; alongKm: number };

/** One line on the Travel Radar: something useful AHEAD on this journey. */
export type RadarItem = {
  key: string;
  kind: PoiKind;
  name: string;
  lat: number;
  lng: number;
  etaMin: number;
  aheadKm: number;
  detourMin: number;
  open: OpenStatus;
  /** Context that makes it timely, e.g. "Sunset in 42 min". */
  note: string | null;
  score: number;
  hours: string | null;
  fetchedAt: string;
};

export type HealthTone = "good" | "warn" | "bad" | "unknown";
export type TripHealth = {
  schedule: { label: string; detail: string; tone: HealthTone };
  driving: { label: string; minutes: number; tone: HealthTone };
  weather: { label: string; detail: string; tone: HealthTone };
  /** Minutes left in the day (until the day's target end), or null. */
  timeLeftMin: number | null;
};

/** The forecast right now at the nearest forecast point, plus the next few hours. Real forecast data only. */
export type WeatherNow = {
  tempC: number;
  precipProb: number | null;
  precipMm: number;
  next: { clock: string; tempC: number; precipProb: number | null }[];
  /** How far the forecast point is from where you are (km). Shown when it is not essentially "here". */
  pointKm: number;
};

/** The next sun event that matters to a traveller. */
export type SunNext = { label: "Sunrise" | "Sunset"; clock: string; inMin: number; tomorrow: boolean };

export type IntelResult = {
  /** Which version of the scoring rules produced this (see lib/intel/weights.ts). */
  algorithmVersion: string;
  generatedAt: string;
  remainingKm: number;
  finishClock: string | null;
  sun: { sunrise: string; sunset: string } | null;
  smartStops: SmartStop[];
  advice: Advice[];
  aheadByKind: Partial<Record<PoiKind, RankedPoi[]>>;
  stopEtas: StopEta[];
  notes: string[];
  radar: RadarItem[];
  health: TripHealth;
  weatherNow: WeatherNow | null;
  sunNext: SunNext | null;
};
