// The Phase 3 engine's inputs and outputs. The engine is PURE: every fact (road times, road lines, heights, weather, towns) is fetched
// before and passed in, so the same input always gives the same plan, and tests drive every case without a network.
import type { Group, Interest, Pace, TravelMode } from "@/lib/intake/types";
import type { BuilderInput, BuilderPlace, DayPlan, PlanOption, Warning } from "@/lib/trip-builder/types";

export type VariantId = "relaxed" | "balanced" | "most";
export const VARIANTS: VariantId[] = ["relaxed", "balanced", "most"];
export const VARIANT_LABEL: Record<VariantId, string> = { relaxed: "Relaxed", balanced: "Balanced", most: "Most places" };

/** What the traveller told us (Phase 2 intake), with the engine's defaults filled in. */
export type Prefs = {
  pace: Pace;
  maxDriveHours: number | null;
  nightDriving: boolean;
  group: Group | null;
  interests: Interest[];
  mode: TravelMode;
};
export const DEFAULT_PREFS: Prefs = { pace: "balanced", maxDriveHours: null, nightDriving: false, group: null, interests: [], mode: "car" };

/** A real town (GeoNames), for night halts. */
export type Town = { name: string; area: string; lat: number; lng: number; pop: number };
/** Nearest towns to a point within `maxKm`, nearest first. */
export type TownFinder = (lat: number, lng: number, maxKm: number) => (Town & { km: number })[];

/** A real road line (OSRM) with the time and distance of every piece, for splitting long drives into days. */
export type RoadLine = {
  coords: [number, number][];
  /** Seconds and metres of each piece between coords[i] and coords[i+1] (length = coords.length − 1). */
  durations: number[];
  distances: number[];
  /** Pieces that are on a sustained climb or descent (from real heights), for the hill margin. Same length as durations. */
  hill?: boolean[];
  source: "osrm" | "estimate";
};

export type EngineInput = {
  /** The builder's input: places, start, end, number of days, dates, road matrix (RAW routing times, no margin yet), opening hours. */
  base: BuilderInput;
  /** The date used for sunset when the trip has no dates (the month the traveller said, else this month). */
  refDateISO: string;
  prefs: Prefs;
  /** Heights (m) of the matrix points [start, ...places, end?], or null when the height service didn't answer. */
  heights: (number | null)[] | null;
  towns: TownFinder;
  /** The road from the start to the first place reached, for splitting a long drive. Null when not fetched. */
  outLine: RoadLine | null;
  /** The road back to the start, for a round trip. Null when not needed or not fetched. */
  backLine: RoadLine | null;
  /** Weather source of each place's day fit: "forecast" (≤16 days), "typical" (6-year average), or none (no dates). */
  weather: "forecast" | "typical" | "mixed" | "none";
  /** km per litre for fuel (null = no own vehicle). */
  mileage: number | null;
  /** Tolls along the main roads, when they could be checked. */
  tolls: { count: number; checked: boolean } | null;
  /** States the places are in (for the permit notes). */
  states: (string | null)[];
};

export type TransitDay = {
  day: number;
  from: string;
  to: string;
  driveMin: number;
  km: number;
  /** "check stays here" when the halt is a small town. */
  haltNote: string | null;
  /** The day ends early because driving after dark was refused. */
  daylightLimited: boolean;
  /** Where the day ends (the halt town, or the road point when no town is near), for the map. */
  at?: { lat: number; lng: number };
};

export type NightHalt = { day: number; town: string; area: string; km: number; driveMin: number; pop: number; checkStays: boolean; atStop: boolean; /** The town, for the map. */ at?: { lat: number; lng: number } };

export type Variant = {
  id: VariantId;
  label: string;
  /** The builder's plan, with day numbers counted from the start of the WHOLE trip (transit days included). */
  option: PlanOption;
  transitOut: TransitDay[];
  transitBack: TransitDay[];
  halts: NightHalt[];
  /** True when every must-see fits and no rule is broken. */
  feasible: boolean;
  totals: { days: number; places: number; km: number; driveMin: number; nights: number; litres: number | null };
  /** Plain words: what this variant gives up compared with the others. */
  tradeoff: string;
  /** Days that would fit everything at this pace, when they don't fit now (null when more days wouldn't help). */
  needDays: number | null;
  /** Quick "what if I had N days?" for N = 1 .. days + WHAT_IF_EXTRA_DAYS. */
  whatIf: WhatIf[];
};

export type Labels = {
  /** "routed" = OpenStreetMap road network (no live traffic); "estimated" = straight-line guesses. */
  roads: "routed" | "estimated" | "partly estimated";
  roadsText: string;
  margin: string;
  weather: string;
  hours: string;
  daylight: string;
  halts: string;
  fuel: string;
  tolls: string;
};

export type WhatIf = { days: number; places: number; of: number; driveMin: number; km: number; fits: boolean };

export type EnginePlan = {
  variants: Variant[];
  recommended: VariantId;
  /** Identical variants grouped ("Relaxed and Balanced give the same plan"). */
  sameAs: Partial<Record<VariantId, VariantId>>;
  labels: Labels;
  permits: string[];
  /** Why the chosen direction ("Going this way round saves 1 h 40 min"), or null. */
  direction: string | null;
  notes: string[];
  warnings: Warning[];
};

/** What the screen gets besides the three plans themselves (which travel as the builder's options, keyed by style). */
export type EngineView = {
  recommendedStyle: string;
  sameAs: Partial<Record<VariantId, VariantId>>;
  labels: Labels;
  permits: string[];
  direction: string | null;
  notes: string[];
  warnings: Warning[];
  numDays: number;
  mileage: number | null;
  nightDriving: boolean;
  variants: (Omit<Variant, "option"> & { style: string })[];
};

export type { BuilderPlace, DayPlan };
