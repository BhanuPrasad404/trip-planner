// The feed's shared vocabulary. Rows come from the database (snake_case) and are turned into these once, at the edge.

import type { CrowdLevel } from "./experience";

export type PostKind = "photo" | "video" | "report";

export type Counters = {
  likes: number; comments: number; saves: number; shares: number;
  /** "This helped me decide" and "I added this to my trip": per distinct person, the strongest planning signals we have. */
  helpful: number; tripAdds: number;
  impressions: number; plays: number; completions: number; skips: number; watchMs: number;
};

/** One post the ranker may choose. Everything here is already known from ONE database round trip. */
export type FeedCandidate = {
  id: string;
  authorId: string;
  username: string;
  displayName: string | null;
  destinationId: string;
  destinationName: string;
  destinationSlug: string;
  /** How many posts the destination has (cheap popularity signal kept by a trigger). */
  destinationPosts: number;
  kind: PostKind;
  caption: string | null;
  placeName: string;
  lat: number;
  lng: number;
  locationPrecision: "exact" | "approx";
  capturedAt: string;
  createdAt: string;
  commentsAllowed: "everyone" | "followers" | "off";
  /** Length of the first video, if any. */
  durationS: number | null;
  counters: Counters;
  // What the traveler said about the place, beyond the picture (all optional).
  crowd: CrowdLevel | null;
  conditions: string[];
  vibes: string[];
  tip: string | null;
  /** Posted while the phone was near the destination (cannot be proven, so never shown as "verified"). */
  fromArea: boolean;
  /** Which candidate pools picked it (destination | near | following | trending | fresh). */
  pools: string[];
  followed: boolean;
  liked: boolean;
  saved: boolean;
  helped: boolean;
  seenAt: string | null;
  seenPct: number | null;
};

/** What we know about the person asking. Every field is optional: a brand-new user has none of it. */
export type FeedContext = {
  nowMs: number;
  userId: string;
  /** Destinations near the stops of the trip being planned. */
  tripDestinationIds: Set<string>;
  /** destinationId → how much they engage with it (likes×1, saves×2, watched×1 …). */
  affinity: Map<string, number>;
  /** Lower-case words from their profile interests. */
  interests: string[];
  position: { lat: number; lng: number } | null;
  /** Makes tie-breaks and exploration vary between sessions but stay stable within one. */
  seed: string;
  /** destinationId → average smoothed engagement of its candidates (filled by rank()). */
  destinationEngagement: Map<string, number>;
};

export type ScoreParts = {
  relevance: number; freshness: number; quality: number; velocity: number;
  popularity: number; social: number; exploration: number;
  /** How much a planner can USE it: a tip, conditions, a crowd level, and people saying it helped. */
  usefulness: number;
  /** Subtracted: seen recently, your own post, quick-skip history. */
  penalty: number;
};
export type Scored = { candidate: FeedCandidate; score: number; parts: ScoreParts };

/** Anything that can score a candidate. Today: the transparent formula. Later: a learned model — same interface, nothing else changes. */
export interface Scorer {
  readonly id: string;
  score(c: FeedCandidate, ctx: FeedContext): Scored;
}

export type Ranked = Scored & {
  /** Score after diversity adjustments — what actually decided the position. */
  adjusted: number;
  slot: "normal" | "explore";
};
