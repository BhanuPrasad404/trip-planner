// Every tunable number of the feed lives here, named. Change a number, not the algorithm.

/** Weights of the scoring components. Each component is 0..1, so the sum of weights is the maximum score. */
export type Weights = { relevance: number; freshness: number; quality: number; velocity: number; popularity: number; social: number; exploration: number; usefulness: number };

export const WEIGHTS: Weights = { relevance: 0.28, freshness: 0.16, quality: 0.16, velocity: 0.08, popularity: 0.08, social: 0.08, exploration: 0.08, usefulness: 0.08 };

/** A person with no trip, no saves, no follows and no history: lean on what is good, fresh and popular right now. */
export const COLD_START_WEIGHTS: Weights = { relevance: 0.10, freshness: 0.20, quality: 0.22, velocity: 0.12, popularity: 0.16, social: 0, exploration: 0.10, usefulness: 0.10 };

/** How fast content stops being "current". A trail-condition report is stale in days; a lovely photo of a fort is not. */
export const HALF_LIFE_HOURS = { report: 48, video: 24 * 10, photo: 24 * 14 } as const;

export const QUALITY = {
  /** Pseudo-impressions of "average" behaviour mixed into every post so a post with 2 views and 1 like is not "50% engaging". */
  priorImpressions: 30,
  priorEngagementRate: 0.06,
  priorCompletionRate: 0.35,
  priorSkipRate: 0.2,
  /** Engagement rate that counts as clearly good (maps to ~0.63 of the scale). */
  engagementScale: 0.08,
  /** Weighted actions: a comment says more than a like. */
  // A like is a smile; a save is intent; "helpful" and "added to my trip" are someone using it to plan.
  actionWeights: { like: 1, save: 2, comment: 3, share: 1.5, helpful: 3, tripAdd: 4 },
} as const;

/** How much "helpful" / "added to my trip" evidence counts. Strong smoothing: a single vote on a handful of views must stay modest. */
export const USEFULNESS = { priorImpressions: 60, priorRate: 0.02, rateScale: 0.25 } as const;

export const RELEVANCE = {
  tripDestination: 1,
  /** Affinity ≥ this saturates (a few saves/likes in that destination). */
  affinityAt: 4,
  affinityMax: 0.9,
  nearKm: 150,
  nearMax: 0.7,
  interestMatch: 0.15,
  interestMax: 0.3,
} as const;

export const EXPLORATION = {
  /** Only posts this young and this unseen get the exploration bonus. */
  maxAgeDays: 7,
  maxImpressions: 100,
  /** Every Nth slot may be given to an under-exposed good post. */
  everyNth: 5,
  /** An exploration pick must score at least this share of the best alternative. */
  minShareOfBest: 0.7,
} as const;

export const PENALTY = {
  seenWithin24h: 0.9,
  /** Seen long ago still counts a little, fading with this half-life. */
  seenHalfLifeDays: 3,
  watchedThrough: 0.15,
  ownPost: 0.4,
  heavySkip: 0.25,
} as const;

export const DIVERSITY = {
  window: 40,          // look at the best N remaining when choosing the next item
  creatorLookback: 8,  // same creator within the last N picks is discouraged…
  creatorFactor: 0.6,  // …each repeat multiplies the score by this
  creatorHardGap: 2,   // …and never twice in a row (within this many picks) unless nothing else exists
  destinationLookback: 6,
  destinationFactor: 0.7,
  destinationMaxRun: 2, // never more than this many consecutive posts from one destination (unless nothing else exists)
  kindRunFactor: 0.85,  // two of the same kind in a row: gentle nudge to mix photos, videos, reports
} as const;

export const PAGE = {
  size: 8,
  snapshot: 80,        // how many ranked ids one ranking pass produces
  candidatesPerPool: 60,
  seenTail: 150,       // ids remembered between snapshots so a refill does not repeat the last one
} as const;

/** What the person is here to do. Same engine, different priorities — so a model can later learn these instead of us setting them. */
export const INTENT_IDS = ["for_you", "now", "planning", "trip", "gems"] as const;
export type IntentId = (typeof INTENT_IDS)[number];

export type Intent = {
  label: string;
  hint: string;
  weights: Weights;
  /** Only posts newer than this (conditions are about NOW). */
  maxAgeDays?: number;
  /** Only destinations on the trip being planned. */
  onlyTrip?: boolean;
  /** Prefer the less-known: popularity counts for the opposite. */
  lowPopularity?: boolean;
};

export const INTENTS: Record<IntentId, Intent> = {
  for_you: { label: "For you", hint: "A mix chosen for you", weights: WEIGHTS },
  now: { label: "Right now", hint: "What it looks like this week", maxAgeDays: 7,
    weights: { relevance: 0.15, freshness: 0.40, quality: 0.10, velocity: 0.10, popularity: 0, social: 0.05, exploration: 0.05, usefulness: 0.15 } },
  planning: { label: "Planning", hint: "Tips, conditions and what helped people decide",
    weights: { relevance: 0.20, freshness: 0.08, quality: 0.17, velocity: 0.02, popularity: 0.05, social: 0.03, exploration: 0.05, usefulness: 0.40 } },
  trip: { label: "My trip", hint: "Only the places on your trip", onlyTrip: true,
    weights: { relevance: 0.35, freshness: 0.20, quality: 0.15, velocity: 0.05, popularity: 0.05, social: 0.05, exploration: 0.05, usefulness: 0.10 } },
  gems: { label: "Hidden gems", hint: "Well-loved places few have found", lowPopularity: true,
    weights: { relevance: 0.10, freshness: 0.10, quality: 0.25, velocity: 0.03, popularity: 0.10, social: 0.02, exploration: 0.20, usefulness: 0.20 } },
};
