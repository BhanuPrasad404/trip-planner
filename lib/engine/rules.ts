// Every number the Phase 3 engine adds on top of lib/trip-builder, in one place, with why it exists. Changing one changes plans: say so
// in the report and the tests.

/**
 * Free routing (OSRM) gives times for a clear road at the speed limit; Indian roads are slower (trucks, towns, ghats). We cannot
 * measure by how much with free data, so we add a stated PLANNING MARGIN (the traveller's decision 1, Phase 3):
 *   +15% on every drive, +30% on hill drives. This is on top of the builder's own +10% for fuel and tea stops.
 */
export const ROAD_MARGIN = 0.15;
export const HILL_MARGIN = 0.3;
export const MARGIN_LABEL = "Drive times include a margin for Indian road conditions (+15%, +30% on hill roads). It is a planning margin, not a measurement.";

/** A drive counts as a HILL drive when the two ends differ by this much in height… */
export const HILL_RISE_M = 600;
/** …or both ends are this high (mountain roads between hill towns). */
export const HILL_BOTH_ABOVE_M = 1200;

/** Along a long road (heights sampled about every 20 km): a stretch that climbs or drops this much is a hill stretch. */
export const HILL_LINE_RISE_M = 300;

/** No driving after dark (the default, decision D9): every drive must arrive by sunset; on a hill drive, an hour before. */
export const HILL_DARK_BUFFER_MIN = 60;

/** A night halt is a real town: preferably at least this big (stays are likely) within NIGHT_HALT_KM of the day's last stop (decision 3). */
export const HALT_MIN_POP = 20_000;
export const NIGHT_HALT_KM = 25;
/** Failing that, the nearest town within this distance, labelled "check stays here". */
export const HALT_ANY_KM = 40;
/** Halt drives are short; their time is estimated from the straight line (× road factor, at this average speed) and labelled so. */
export const HALT_ROAD_FACTOR = 1.35;
export const HALT_KMH = 40;

/** Long drives split into transit days: a halt town must be within this distance of the road. */
export const TRANSIT_TOWN_KM = 15;
/** Time on a transit day kept for breaks and meals (not driving). */
export const TRANSIT_BREAK_MIN = 60;

/** Fuel (decision 2): litres first, from the traveller's mileage. Defaults, always shown as "change to your vehicle's". */
export const DEFAULT_MILEAGE_KM_PER_L: Record<"car" | "bike", number> = { car: 15, bike: 40 };

/** Kids or elders: gentler days. */
export const FAMILY_CAPACITY_SHARE = 0.85;
export const FAMILY_MAX_DRIVE_MIN = 270;
/** An interest makes matching kinds of place this much more valuable when something has to be left out. */
export const INTEREST_APPEAL = 1.4;

/** "What if I had N days?" looks this many days past the trip's length. */
export const WHAT_IF_EXTRA_DAYS = 5;

/** Weather: real forecast within this many days, "typical for this week" (6-year average) beyond. */
export const FORECAST_DAYS = 16;
