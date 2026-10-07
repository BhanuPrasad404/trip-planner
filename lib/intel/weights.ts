// Every tunable number behind "is this place useful to ME right now?" lives here, with the reason it exists.
// Change a number → bump ALGORITHM_VERSION, so "why did the advice change?" always has an answer.

/** Stamped on every IntelResult. Bump when scoring or thresholds change. */
export const ALGORITHM_VERSION = "intel-2026.10.2";

/** How the 0–100 place score is made. The five weights add up to 1 (checked by a test). */
export const SCORE_WEIGHTS = {
  /** Closer along the road is more useful (decays per kind: see SCALE_KM in ranking.ts). */
  proximity: 0.35,
  /** Minutes lost leaving the road and coming back — a 4 km place needing a 9 km detour is NOT a 4 km place. */
  detour: 0.25,
  /** Open when you would actually ARRIVE, not right now. */
  openness: 0.15,
  /** Has a name, hours, a website, a known brand: data we can stand behind. */
  quality: 0.15,
  /** Recent updates from real travelers near it. */
  freshness: 0.1,
} as const;

/** How sure we are a place is open, by what the map says. Unknown is neither open nor closed. */
export const OPENNESS = { open: 1, unknown: 0.65, closed: 0.2 } as const;

/** Leaving the road: out and back at about 35 km/h (≈583 m/min), plus a minute to turn in and park. */
export const DETOUR = {
  metresPerMinute: 583, fixedMin: 1, onRoadWithinM: 150, halfScoreAtMin: 4,
  /** A place whose detour BY ROAD costs more than this is not a practical stop and is not recommended. */
  maxPracticalMin: 25,
  /** The "rejoin" point used to measure a detour: this far further along the road than where you would leave it. */
  rejoinAheadM: 3_000,
} as const;

/** Weather changes what is worth stopping for. */
export const WEATHER_FIT = {
  rainyViewpoint: 0.5,
  rainySight: 0.75,
  rainShelter: 1.15, // cafés / food while it rains
  hotCoolBreak: 1.15,
  hotFromC: 36,
  rainyProbPct: 60,
  rainyMm: 1.5,
} as const;
