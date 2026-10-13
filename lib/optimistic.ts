// Instant feedback for the three most-used actions on a stop (mark done / skip / undo, vote, remove).
//
// The screen changes the moment you tap, so the app never feels stuck, while the real request runs in the background. This is NOT
// pretending the save worked:
//   • the card keeps a "Saving…" marker until the server has really answered;
//   • if the request FAILS the change is taken back at once and the error is shown;
//   • the moment fresh data arrives from the server, it replaces these local changes completely (they are tied to the exact data
//     they were made on, so they cannot linger or pile up).
// Pure functions: no React, no network. Tested in tests/optimistic.test.ts.
import type { VoteSummary } from "@/lib/votes";

export type StopStatus = "planned" | "done" | "skipped";
export type PlaceOverride = { status?: StopStatus; removed?: boolean };

export type Overrides = {
  /** The exact server data these changes were made on. When the server sends new data (a new array/object), they are discarded. */
  basePlaces: unknown;
  baseVotes: unknown;
  places: Record<string, PlaceOverride>;
  votes: Record<string, -1 | 0 | 1>;
};

export const NO_OVERRIDES: Overrides = { basePlaces: null, baseVotes: null, places: {}, votes: {} };

/** Keep only the changes that were made on exactly this server data. */
const live = (o: Overrides, serverPlaces: unknown, serverVotes: unknown): Overrides =>
  o.basePlaces === serverPlaces && o.baseVotes === serverVotes ? o : { basePlaces: serverPlaces, baseVotes: serverVotes, places: {}, votes: {} };

export function withPlaceOverride(cur: Overrides, serverPlaces: unknown, serverVotes: unknown, id: string, patch: PlaceOverride): Overrides {
  const o = live(cur, serverPlaces, serverVotes);
  return { ...o, places: { ...o.places, [id]: { ...o.places[id], ...patch } } };
}

export function withVoteOverride(cur: Overrides, serverPlaces: unknown, serverVotes: unknown, id: string, vote: -1 | 0 | 1): Overrides {
  const o = live(cur, serverPlaces, serverVotes);
  return { ...o, votes: { ...o.votes, [id]: vote } };
}

/** Take a change back (the request failed). */
export function dropOverride(cur: Overrides, id: string): Overrides {
  if (!(id in cur.places) && !(id in cur.votes)) return cur;
  const places = { ...cur.places }; const votes = { ...cur.votes };
  delete places[id]; delete votes[id];
  return { ...cur, places, votes };
}

type StatusPlace = { id: string; status?: string | null; status_at?: string | null };

/** The places as they should look right now: server data + local changes made on that same data. Returns the SAME array if nothing changed. */
export function applyPlaceOverrides<P extends StatusPlace>(places: P[], o: Overrides, serverPlaces: unknown, now: () => string = () => new Date().toISOString()): P[] {
  if (o.basePlaces !== serverPlaces || Object.keys(o.places).length === 0) return places;
  const out: P[] = [];
  for (const p of places) {
    const ov = o.places[p.id];
    if (!ov) { out.push(p); continue; }
    if (ov.removed) continue;
    out.push(ov.status ? ({ ...p, status: ov.status, status_at: ov.status === "planned" ? null : now() } as P) : p);
  }
  return out;
}

/** What a vote summary becomes when the signed-in person changes their own vote to `next`. */
export function withVote(s: VoteSummary | undefined, next: -1 | 0 | 1): VoteSummary {
  const cur = s ?? { up: 0, down: 0, score: 0, mine: 0 as const };
  let { up, down } = cur;
  if (cur.mine === 1) up = Math.max(0, up - 1);
  if (cur.mine === -1) down = Math.max(0, down - 1);
  if (next === 1) up++;
  if (next === -1) down++;
  return { up, down, score: up - down, mine: next };
}

export function applyVoteOverrides(votes: Record<string, VoteSummary>, o: Overrides, serverVotes: unknown): Record<string, VoteSummary> {
  if (o.baseVotes !== serverVotes) return votes;
  const ids = Object.keys(o.votes);
  if (ids.length === 0) return votes;
  const out = { ...votes };
  for (const id of ids) out[id] = withVote(votes[id], o.votes[id]);
  return out;
}
