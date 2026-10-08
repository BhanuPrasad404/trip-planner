// The ranking pipeline: candidates → score → order → diversify. Pure and deterministic (same input + seed = same output).
import { COLD_START_WEIGHTS, INTENTS, PAGE, WEIGHTS, type IntentId } from "./config";
import { diversify, jitter } from "./diversity";
import { ageHours, engagementQuality, isColdStart, makeScorer } from "./scoring";
import type { FeedCandidate, FeedContext, Ranked, Scorer } from "./types";

export type RankInput = Omit<FeedContext, "destinationEngagement">;
export type RankOptions = { n?: number; exclude?: ReadonlySet<string>; scorer?: Scorer; intent?: IntentId };

export function rankFeed(candidates: FeedCandidate[], input: RankInput, opts: RankOptions = {}): Ranked[] {
  const n = opts.n ?? PAGE.snapshot;
  // 1. De-duplicate (a post can arrive from several pools) and drop what must not repeat.
  const intent = INTENTS[opts.intent ?? "for_you"];
  const seen = new Set<string>();
  const pool = candidates.filter((c) => {
    if (seen.has(c.id) || opts.exclude?.has(c.id)) return false;
    // Intent filters: "Right now" is about now; "My trip" is only the trip.
    if (intent.maxAgeDays !== undefined && ageHours(c, input.nowMs) > intent.maxAgeDays * 24) return false;
    if (intent.onlyTrip && !input.tripDestinationIds.has(c.destinationId)) return false;
    seen.add(c.id);
    return true;
  });
  if (pool.length === 0) return [];

  // 2. Destination-level engagement, from the candidates themselves (no extra query).
  const sum = new Map<string, { total: number; count: number }>();
  for (const c of pool) {
    const e = sum.get(c.destinationId) ?? { total: 0, count: 0 };
    e.total += engagementQuality(c); e.count++;
    sum.set(c.destinationId, e);
  }
  const destinationEngagement = new Map([...sum].map(([id, v]) => [id, v.total / v.count]));
  const ctx: FeedContext = { ...input, destinationEngagement };

  // 3. Cold start: nothing known about the person → weights that lean on quality, freshness and popularity.
  const cold = isColdStart(ctx, pool.some((c) => c.followed));
  // The default intent keeps the cold-start behaviour; every other intent brings its own priorities.
  const weights = opts.intent && opts.intent !== "for_you" ? intent.weights : cold ? COLD_START_WEIGHTS : WEIGHTS;
  const scorer = opts.scorer ?? makeScorer(weights, weights, false, { lowPopularity: intent.lowPopularity });

  // 4. Score, order (ties broken by the session jitter), then diversify.
  const scored = pool.map((c) => scorer.score(c, ctx)).sort((a, b) => b.score - a.score || jitter(input.seed, b.candidate.id) - jitter(input.seed, a.candidate.id));
  return diversify(scored, n, input.seed);
}
