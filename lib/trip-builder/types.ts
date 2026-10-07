import type { PlaceCategory } from "@/lib/categories";
import type { Priority, StyleId } from "./config";

export type BuilderPlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: PlaceCategory;
  priority: Priority;
  /** The traveller's own time at this place (minutes), overriding the category default. */
  visitMin?: number | null;
  /** OpenStreetMap-style opening hours when we actually know them; otherwise null → "unknown", never assumed open. */
  hours?: string | null;
  /** Group preference −1..1 from votes (optional). */
  vote?: number;
  /** Weather fit 0–100 for each trip day (index 0 = day 1). null = unknown for that day. */
  fit?: (number | null)[];
  /** Short plain-English weather note per day, shown in explanations (e.g. "31°C, ~2 mm rain"). */
  fitNote?: (string | null)[];
};

export type EndMode = "free" | "start" | "point";

export type BuilderInput = {
  places: BuilderPlace[];
  start: { lat: number; lng: number; label: string };
  /** Only used when endMode = "point". */
  end: { lat: number; lng: number; label: string } | null;
  endMode: EndMode;
  numDays: number;
  /** First trip day as "YYYY-MM-DD" (local calendar date), if the trip has dates. */
  startDateISO: string | null;
  /** Minutes the destination's clock is ahead of UTC (IST = 330). */
  utcOffsetMin: number;
  /** Road driving matrix over [start, ...places (input order), end?]. Seconds and metres. */
  matrix: { durations: number[][]; distances: number[][]; source: string; /** Pairs with no road found (filled by estimate). */ estimatedPairs?: number };
};

export type StopFlag = "closed_at_arrival" | "waited_for_opening" | "hours_unknown" | "golden_ok" | "golden_missed" | "late_arrival" | "weather_poor" | "long_transfer";

export type PlannedStop = {
  placeId: string;
  name: string;
  day: number; // 1-based
  order: number; // 1-based within the day
  arriveMin: number; // minutes after local midnight
  departMin: number;
  /** Driving from the previous point (including the overnight place for the day's first stop), minutes — routing time plus the drive buffer. */
  driveMin: number;
  driveKm: number;
  visitMin: number;
  waitMin: number;
  flags: StopFlag[];
  /** Why this stop is here — every line is built from the numbers used to decide. */
  reasons: string[];
  /** Compass direction from the previous point ("SW") and its road distance. */
  fromPrev: { dir: string; km: number; fromName: string };
};

export type Intensity = "comfortable" | "moderate" | "heavy" | "overloaded";

export type DayPlan = {
  day: number;
  date: string | null;
  stops: PlannedStop[];
  driveMin: number;
  driveKm: number;
  visitMin: number;
  bufferMin: number;
  /** drive + visit + buffers: what counts against the day's capacity. */
  loadMin: number;
  capacityMin: number;
  intensity: Intensity;
  startMin: number;
  endMin: number;
  /** Where the night is spent ("near Pune"), i.e. the day's last stop. Null on the last day. */
  overnightNear: string | null;
  /** Why the day ends here, from the numbers (null on the last day). */
  whyEnds: string | null;
  /** Final leg back to the start / chosen end point (last day only). Already included in the day's drive and load. */
  returnLeg: { to: string; driveMin: number; km: number } | null;
  longTransfer: boolean;
};

export type WarningCode = "too_much_driving" | "backtracking" | "closed_at_arrival" | "tight_day" | "late_arrival" | "mostly_driving" | "weather_poor" | "hours_unknown" | "over_capacity" | "must_do_dropped" | "heavy_streak" | "estimated_times" | "long_transfer" | "empty_days";
export type Warning = { code: WarningCode; severity: "info" | "warn" | "risk"; message: string; day?: number; placeId?: string };

export type RemovedStop = { placeId: string; name: string; savedMin: number; savedDriveMin: number; reason: string };

export type PlanOption = {
  style: StyleId;
  label: string;
  tagline: string;
  /** All your must-do places fit and every day is within its limits. */
  feasible: boolean;
  days: DayPlan[];
  kept: string[];
  removed: RemovedStop[];
  totals: { places: number; km: number; driveMin: number; visitMin: number; nights: number; daysUsed: number };
  warnings: Warning[];
  /** Places that were dropped but could be added back, with the real cost of doing so. */
  canAddBack: AddSuggestion[];
};

export type Reality = {
  places: number;
  numDays: number;
  driveMin: number;
  driveKm: number;
  visitMin: number;
  bufferMin: number;
  mealMin: number;
  /** drive + visit + buffers */
  neededMin: number;
  /** numDays × the style's realistic daily capacity */
  availableMin: number;
  overMin: number;
  status: "fits" | "tight" | "over";
  headline: string;
};

export type Cluster = {
  id: string;
  label: string;
  placeIds: string[];
  /** The most central place (least total road time to the others). */
  centerId: string;
  /** Longest road time between any two places inside the cluster. */
  spanMin: number;
  centroid: { lat: number; lng: number };
  /** Compass direction and road km from the trip start to the cluster centre. */
  fromStart: { dir: string; km: number; driveMin: number };
};

export type RemoveSuggestion = { placeId: string; name: string; savedMin: number; savedDriveMin: number; fitsAfter: boolean; message: string };
export type AddSuggestion = { placeId: string; name: string; day: number | null; extraDriveMin: number; extraTotalMin: number; spareAfterMin: number | null; fits: boolean; message: string };

/** What it costs to include one place: the drive from the trip start, the time there, and the total commitment. */
export type PlaceCost = { placeId: string; fromStart: { dir: string; km: number; driveMin: number }; visitMin: number; totalMin: number; clusterId: string | null };

export type BuilderResult = {
  version: string;
  routing: string;
  numDays: number;
  reality: Reality;
  clusters: Cluster[];
  placeCosts: PlaceCost[];
  options: PlanOption[];
  removeSuggestions: RemoveSuggestion[];
  /** Plain statements about input problems (duplicates, unknown hours…). */
  notes: string[];
};
