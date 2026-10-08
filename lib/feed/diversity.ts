// Diversity re-ranking: turn "the best N posts" into "a feed worth scrolling".
// Greedy: at each position take the best remaining post AFTER discounting repeats of the same creator, destination or kind
// among the posts just chosen. Hard rules (no creator twice in a row, no long run from one destination) are relaxed only when
// nothing else is left — so the feed is never emptied by its own rules. Every Nth slot may go to an under-exposed good post.
import { DIVERSITY, EXPLORATION } from "./config";
import type { Ranked, Scored } from "./types";

/** Small stable hash (FNV-1a) → 0..1. Only used to break exact ties, differently per session but identically within one. */
export function jitter(seed: string, id: string): number {
  let h = 0x811c9dc5;
  const s = `${seed}:${id}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) / 0xffffffff;
}

export function diversify(sorted: Scored[], n: number, seed: string): Ranked[] {
  const remaining = [...sorted];
  const out: Ranked[] = [];

  const adjustedFor = (s: Scored): number => {
    const c = s.candidate;
    let factor = 1;
    const recentCreators = out.slice(-DIVERSITY.creatorLookback);
    factor *= Math.pow(DIVERSITY.creatorFactor, recentCreators.filter((r) => r.candidate.authorId === c.authorId).length);
    const recentDest = out.slice(-DIVERSITY.destinationLookback);
    factor *= Math.pow(DIVERSITY.destinationFactor, recentDest.filter((r) => r.candidate.destinationId === c.destinationId).length);
    const last2 = out.slice(-2);
    if (last2.length === 2 && last2.every((r) => r.candidate.kind === c.kind)) factor *= DIVERSITY.kindRunFactor;
    // Discount the positive part only: a penalised (negative) score must not become "less negative" by being multiplied.
    return (s.score > 0 ? s.score * factor : s.score) + jitter(seed, c.id) * 1e-6;
  };

  const passesHardRules = (s: Scored): boolean => {
    const c = s.candidate;
    if (out.slice(-DIVERSITY.creatorHardGap).some((r) => r.candidate.authorId === c.authorId)) return false;
    const run = out.slice(-DIVERSITY.destinationMaxRun);
    if (run.length === DIVERSITY.destinationMaxRun && run.every((r) => r.candidate.destinationId === c.destinationId)) return false;
    return true;
  };

  while (out.length < n && remaining.length > 0) {
    const window = remaining.slice(0, DIVERSITY.window);
    const scored = window.map((s, i) => ({ s, i, adj: adjustedFor(s), ok: passesHardRules(s) }));
    const allowed = scored.some((x) => x.ok) ? scored.filter((x) => x.ok) : scored;   // relax rules rather than run dry
    const best = allowed.reduce((a, b) => (b.adj > a.adj ? b : a));

    let pick = best;
    let slot: Ranked["slot"] = "normal";
    if ((out.length + 1) % EXPLORATION.everyNth === 0) {
      const explorers = allowed.filter((x) => x.s.parts.exploration >= 0.5 && x.adj >= EXPLORATION.minShareOfBest * best.adj);
      if (explorers.length > 0) { pick = explorers.reduce((a, b) => (b.adj > a.adj ? b : a)); if (pick !== best) slot = "explore"; }
    }
    out.push({ ...pick.s, adjusted: pick.adj, slot });
    remaining.splice(pick.i, 1);
  }
  return out;
}
