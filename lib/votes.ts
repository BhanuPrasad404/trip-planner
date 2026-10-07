import type { PlaceVote } from "@/lib/types";

export type VoteSummary = { up: number; down: number; score: number; mine: -1 | 0 | 1 };

/** Roll raw vote rows up to one summary per place, including the current user's own vote. */
export function summarizeVotes(rows: Pick<PlaceVote, "place_id" | "user_id" | "vote">[], userId: string): Record<string, VoteSummary> {
  const out: Record<string, VoteSummary> = {};
  for (const r of rows) {
    const s = (out[r.place_id] ??= { up: 0, down: 0, score: 0, mine: 0 });
    if (r.vote === 1) s.up++;
    else if (r.vote === -1) s.down++;
    else continue;
    s.score = s.up - s.down;
    if (r.user_id === userId) s.mine = r.vote;
  }
  return out;
}
