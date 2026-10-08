// The transparent scoring formula (v1). Seven small, separately-testable components, each 0..1, then a weighted sum minus penalties.
// No machine learning is pretended here: this is a deterministic heuristic, built so a model can replace `heuristicScorer` later.
import { effectiveTime } from "@/lib/social/freshness";
import { hasTravelDetail } from "./experience";
import { haversineM } from "@/lib/geo";
import { COLD_START_WEIGHTS, EXPLORATION, HALF_LIFE_HOURS, PENALTY, QUALITY, RELEVANCE, USEFULNESS, WEIGHTS, type Weights } from "./config";
import type { FeedCandidate, FeedContext, ScoreParts, Scored, Scorer } from "./types";

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const ageHours = (c: FeedCandidate, nowMs: number) => Math.max(0, (nowMs - effectiveTime(c.createdAt, c.capturedAt, new Date(nowMs)).getTime()) / HOUR);

/** True when we know nothing about what this person likes: no trip, no history, no one followed. */
export const isColdStart = (ctx: Pick<FeedContext, "tripDestinationIds" | "affinity" | "interests">, anyFollowed: boolean) =>
  ctx.tripDestinationIds.size === 0 && ctx.affinity.size === 0 && ctx.interests.length === 0 && !anyFollowed;

// ── components ──────────────────────────────────────────────────────────────

/** How well this fits THIS person. Independent pieces of evidence combine (noisy-OR): two weak hints beat one. */
export function relevance(c: FeedCandidate, ctx: FeedContext): number {
  const evidence: number[] = [];
  if (ctx.tripDestinationIds.has(c.destinationId)) evidence.push(RELEVANCE.tripDestination);
  const a = ctx.affinity.get(c.destinationId);
  if (a && a > 0) evidence.push(Math.min(RELEVANCE.affinityMax, (a / RELEVANCE.affinityAt) * RELEVANCE.affinityMax));
  if (ctx.position) {
    const km = haversineM(ctx.position, c) / 1000;
    if (km < RELEVANCE.nearKm) evidence.push((1 - km / RELEVANCE.nearKm) * RELEVANCE.nearMax);
  }
  if (ctx.interests.length > 0) {
    const text = `${c.caption ?? ""} ${c.placeName} ${c.destinationName}`.toLowerCase();
    const hits = ctx.interests.filter((w) => text.includes(w)).length;
    if (hits > 0) evidence.push(Math.min(RELEVANCE.interestMax, hits * RELEVANCE.interestMatch));
  }
  return clamp01(1 - evidence.reduce((p, e) => p * (1 - clamp01(e)), 1));
}

/** Half-life decay of how current the content is. */
export function freshness(c: FeedCandidate, nowMs: number): number {
  const half = HALF_LIFE_HOURS[c.kind];
  return Math.max(0.02, Math.pow(0.5, ageHours(c, nowMs) / half));
}

/** Smoothed engagement per impression, 0..1. Smoothing stops a post with 3 views and 1 like looking brilliant. */
export function engagementQuality(c: FeedCandidate): number {
  const { likes, saves, comments, shares, helpful, tripAdds, impressions } = c.counters;
  const w = QUALITY.actionWeights;
  const actions = likes * w.like + saves * w.save + comments * w.comment + shares * w.share + helpful * w.helpful + tripAdds * w.tripAdd;
  const K = QUALITY.priorImpressions;
  const rate = (actions + QUALITY.priorEngagementRate * K) / (impressions + K);
  return 1 - Math.exp(-rate / QUALITY.engagementScale);
}

export function completionQuality(c: FeedCandidate): number {
  const K = QUALITY.priorImpressions;
  return (c.counters.completions + QUALITY.priorCompletionRate * K) / (c.counters.plays + K);
}

export function skipRate(c: FeedCandidate): number {
  const K = QUALITY.priorImpressions;
  return (c.counters.skips + QUALITY.priorSkipRate * K) / (c.counters.impressions + K);
}

/** Overall quality: engagement, plus watch-through for videos, minus a skip penalty once skipping is clearly above normal. */
export function quality(c: FeedCandidate): number {
  const e = engagementQuality(c);
  const watch = c.kind === "video" ? completionQuality(c) : e;
  const skipExcess = Math.max(0, skipRate(c) - QUALITY.priorSkipRate - 0.1);
  return clamp01(0.6 * e + 0.4 * watch - 0.8 * skipExcess);
}

/** Engagement per hour, young posts weighted up — the same idea as the SQL "trending" pool, on a 0..1 scale. */
export function velocity(c: FeedCandidate, nowMs: number): number {
  const { likes, saves, comments, plays } = c.counters;
  const v = (likes + 2 * saves + 3 * comments + 0.2 * plays) / Math.pow(ageHours(c, nowMs) + 4, 1.3);
  return 1 - Math.exp(-v / 1.5);
}

/** Destination popularity: how much content it has and how well that content engages. */
export function popularity(c: FeedCandidate, ctx: FeedContext): number {
  const volume = clamp01(Math.log1p(c.destinationPosts) / Math.log1p(50));
  const engagement = ctx.destinationEngagement.get(c.destinationId) ?? 0.5;
  return clamp01(0.6 * volume + 0.4 * engagement);
}

/**
 * How much a PLANNER can use this: what the traveler told us (tip, crowd, conditions, what was special, a real caption, posted
 * from the area) and what others said back (helpful votes and trip adds, smoothed so one vote on two views is not a verdict).
 */
export function usefulness(c: FeedCandidate): number {
  const structure = Math.min(1,
    (c.tip ? 0.30 : 0) + (c.crowd ? 0.15 : 0) + (c.conditions.length ? 0.15 : 0) + (c.vibes.length ? 0.10 : 0) +
    (c.fromArea ? 0.10 : 0) + ((c.caption?.length ?? 0) >= 40 ? 0.20 : 0));
  const K = USEFULNESS.priorImpressions;
  const rate = (QUALITY.actionWeights.helpful * c.counters.helpful + QUALITY.actionWeights.tripAdd * c.counters.tripAdds + USEFULNESS.priorRate * K) / (c.counters.impressions + K);
  const peer = 1 - Math.exp(-rate / USEFULNESS.rateScale);
  return clamp01(0.6 * structure + 0.4 * peer);
}
export { hasTravelDetail };

/** People you follow. A relationship signal, kept separate so it can be weighted (or removed) on its own. */
export const social = (c: FeedCandidate): number => (c.followed ? 1 : 0);

/** A small boost for young posts that have barely been shown, so good new content gets a chance (an upper-confidence idea). */
export function explorationBonus(c: FeedCandidate, nowMs: number): number {
  if (ageHours(c, nowMs) > EXPLORATION.maxAgeDays * 24) return 0;
  if (c.counters.impressions >= EXPLORATION.maxImpressions) return 0;
  return 1 / Math.sqrt(1 + c.counters.impressions / 10);
}

/** Things that should push a post DOWN: already seen, mine, or skipped by almost everyone. */
export function penalty(c: FeedCandidate, ctx: FeedContext): number {
  let p = 0;
  if (c.seenAt) {
    const days = (ctx.nowMs - Date.parse(c.seenAt)) / DAY;
    p += days < 1 ? PENALTY.seenWithin24h : PENALTY.seenWithin24h * Math.pow(0.5, days / PENALTY.seenHalfLifeDays);
    if ((c.seenPct ?? 0) >= 75) p += PENALTY.watchedThrough;
  }
  if (c.authorId === ctx.userId) p += PENALTY.ownPost;
  if (c.counters.impressions >= 40 && skipRate(c) > 0.6) p += PENALTY.heavySkip;
  return p;
}

// ── the scorer ──────────────────────────────────────────────────────────────

export function makeScorer(weights: Weights = WEIGHTS, coldWeights: Weights = COLD_START_WEIGHTS, cold = false, options: { lowPopularity?: boolean } = {}): Scorer {
  const w = cold ? coldWeights : weights;
  return {
    id: cold ? "heuristic-v1-cold" : "heuristic-v1",
    score(c, ctx): Scored {
      const parts: ScoreParts = {
        relevance: relevance(c, ctx),
        freshness: freshness(c, ctx.nowMs),
        quality: quality(c),
        velocity: velocity(c, ctx.nowMs),
        popularity: options.lowPopularity ? 1 - popularity(c, ctx) : popularity(c, ctx),
        social: social(c),
        exploration: explorationBonus(c, ctx.nowMs),
        usefulness: usefulness(c),
        penalty: penalty(c, ctx),
      };
      const score =
        w.relevance * parts.relevance + w.freshness * parts.freshness + w.quality * parts.quality + w.velocity * parts.velocity +
        w.popularity * parts.popularity + w.social * parts.social + w.exploration * parts.exploration + w.usefulness * parts.usefulness - parts.penalty;
      return { candidate: c, score, parts };
    },
  };
}
