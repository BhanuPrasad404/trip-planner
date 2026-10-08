// Builds one page of the destination feed. Thin orchestration around pure parts:
//   database (candidates, my signals) → rankFeed() → page ids → rows → signed media → small DTOs.
// Stateless: the cursor carries the rest of the ranked snapshot, so nothing is stored per scroll session.
import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE, type IntentId } from "@/lib/feed/config";
import { decodeCursor, encodeCursor } from "@/lib/feed/cursor";
import { rowToCandidate, toItem, type FeedItemDTO, type FeedRow, type MediaDTO } from "@/lib/feed/map";
import { rankFeed } from "@/lib/feed/rank";
import type { FeedCandidate } from "@/lib/feed/types";
import { supabaseMediaStorage, type MediaStorage } from "@/lib/social/storage";

export type FeedRequest = {
  cursor?: string | null;
  limit?: number;
  /** Device position, only used to rank "near me" content higher. Never stored. */
  position?: { lat: number; lng: number } | null;
  /** The trip being planned: its stops decide which destinations are "mine". Resolved server-side under RLS. */
  tripId?: string | null;
  /** What the person is here to do (For you / Right now / Planning / My trip / Hidden gems). */
  intent?: IntentId;
};

export type FeedPage = {
  items: FeedItemDTO[];
  nextCursor: string | null;
  /** True when we knew nothing about this person and used the new-user ranking. */
  coldStart: boolean;
  /** Why the page is empty, when it is more specific than "nothing posted yet" (e.g. My trip with no places on the trip). */
  notice?: string;
  meta: { candidates: number; ranked: number; timings: Record<string, number> };
};

export class FeedError extends Error {
  constructor(message: string, readonly status = 500) { super(message); }
}

type Deps = { now?: () => number; storage?: MediaStorage };
type Rpc = { data: unknown; error: { code?: string; message?: string } | null };

const rpc = async (supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Rpc> => {
  const r = await supabase.rpc(fn, args);
  return { data: r.data, error: r.error };
};
const rows = <T,>(r: Rpc, what: string): T[] => {
  if (r.error) { console.error(`[feed] ${what}:`, r.error.code, r.error.message); throw new FeedError(`${what} failed`); }
  return Array.isArray(r.data) ? (r.data as T[]) : [];
};

/** Person-level signals. Each is best-effort: if one fails the feed still works, just less personal. */
async function loadSignals(supabase: SupabaseClient, userId: string, tripId: string | null | undefined) {
  const affinity = new Map<string, number>();
  const trip = new Set<string>();
  let interests: string[] = [];

  const [aff, prof, stops] = await Promise.all([
    rpc(supabase, "user_destination_affinity", { _days: 90 }),
    supabase.from("profiles").select("interests").eq("id", userId).maybeSingle(),
    tripId ? supabase.from("places").select("lat, lng").eq("trip_id", tripId).limit(12) : Promise.resolve({ data: null, error: null }),
  ]);
  if (!aff.error && Array.isArray(aff.data)) for (const a of aff.data as { destination_id: string; score: number }[]) affinity.set(a.destination_id, Number(a.score) || 0);
  const profile = prof.data as { interests?: string[] } | null;
  interests = (profile?.interests ?? []).map((s) => s.toLowerCase()).slice(0, 8);

  const pts = (stops.data as { lat: number; lng: number }[] | null) ?? [];
  if (pts.length > 0) {
    const near = await rpc(supabase, "destinations_near_points", { _lats: pts.map((p) => p.lat), _lngs: pts.map((p) => p.lng), _radius_km: 40 });
    if (!near.error && Array.isArray(near.data)) for (const id of near.data as string[]) trip.add(id);
  }
  return { affinity, trip, interests, tripPoints: pts };
}

/** Photos/videos for the page's posts: ONE query + ONE signing call, never per post. */
export async function loadMedia(supabase: SupabaseClient, storage: MediaStorage, ids: string[]): Promise<Map<string, MediaDTO[]>> {
  const out = new Map<string, MediaDTO[]>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from("post_media")
    .select("post_id, position, media_type, storage_path, poster_path, width, height, duration_s")
    .in("post_id", ids)
    .order("position", { ascending: true });
  if (error) { console.error("[feed] media:", error.code, error.message); return out; }       // posts still show, just without pictures
  const list = (data ?? []) as { post_id: string; media_type: "image" | "video"; storage_path: string; poster_path: string | null; width: number | null; height: number | null; duration_s: number | string | null }[];
  const urls = await storage.signedUrls([...new Set(list.flatMap((m) => [m.storage_path, ...(m.poster_path ? [m.poster_path] : [])]))], 3600);
  for (const m of list) {
    const url = urls.get(m.storage_path);
    if (!url) continue;                                                                       // an unsignable file is skipped, not fatal
    const arr = out.get(m.post_id) ?? [];
    arr.push({ type: m.media_type, url, posterUrl: m.poster_path ? urls.get(m.poster_path) ?? null : null, width: m.width, height: m.height, durationS: m.duration_s == null ? null : Number(m.duration_s) });
    out.set(m.post_id, arr);
  }
  return out;
}

export async function buildFeedPage(supabase: SupabaseClient, userId: string, req: FeedRequest, deps: Deps = {}): Promise<FeedPage> {
  const clock = deps.now ?? Date.now;
  const t0 = clock();
  const timings: Record<string, number> = {};
  const limit = Math.min(Math.max(Math.floor(req.limit ?? PAGE.size), 1), 12);
  const cursor = decodeCursor(req.cursor);
  const storage = deps.storage ?? supabaseMediaStorage(supabase);
  const position = req.position ?? null;
  const viewNow = new Date(t0);

  let pageCandidates: FeedCandidate[] = [];
  let restIds: string[] = [];
  let seen = cursor?.seen ?? [];
  const gen = cursor ? cursor.gen + (cursor.ids.length === 0 ? 1 : 0) : 0;
  const intent: IntentId = cursor?.intent ?? req.intent ?? "for_you";      // a scroll keeps the mode it started in
  let notice: string | undefined;
  let coldStart = false;
  let candidateCount = 0;
  let rankedCount = 0;

  if (cursor && cursor.ids.length > 0) {
    // ── Later page of the same snapshot: re-fetch exactly these ids (RLS + hides re-applied; deleted ones just drop out).
    const pageIds = cursor.ids.slice(0, limit);
    restIds = cursor.ids.slice(limit);
    const t = clock();
    const fetched = rows<FeedRow>(await rpc(supabase, "feed_items", { _ids: pageIds }), "feed_items");
    timings.items = clock() - t;
    const byId = new Map(fetched.map((r) => [r.id, rowToCandidate(r)]));
    pageCandidates = pageIds.map((id) => byId.get(id)).filter((c): c is FeedCandidate => !!c);
    seen = [...seen, ...pageIds].slice(-PAGE.seenTail);
  } else {
    // ── New snapshot: collect candidates from every pool, rank, diversify, keep the best ~80.
    let t = clock();
    const sig = await loadSignals(supabase, userId, req.tripId);
    timings.signals = clock() - t;
    if (intent === "trip" && sig.trip.size === 0) {
      // "My trip" with nothing to match: say why, instead of showing an unexplained empty feed.
      notice = req.tripId ? "No travelers have posted from the places on this trip yet. Add more stops, or try Right now." : "Open a trip and add its places — posts from those destinations will show up here.";
      return { items: [], nextCursor: null, coldStart: false, notice, meta: { candidates: 0, ranked: 0, timings: { signals: timings.signals, total: clock() - t0 } } };
    }
    t = clock();
    const centre = position ?? (sig.tripPoints.length > 0 ? { lat: sig.tripPoints[0].lat, lng: sig.tripPoints[0].lng } : null);
    const candRows = rows<FeedRow>(await rpc(supabase, "feed_candidates", {
      // "My trip" looks only at the trip's destinations; the other modes also include places this person has engaged with.
      _dest: intent === "trip" ? [...sig.trip] : [...new Set([...sig.trip, ...[...sig.affinity.keys()].slice(0, 10)])],
      _lat: centre?.lat ?? null, _lng: centre?.lng ?? null, _limit: PAGE.candidatesPerPool,
    }), "feed_candidates");
    timings.candidates = clock() - t;
    const candidates = candRows.map(rowToCandidate).filter((c): c is FeedCandidate => !!c);
    candidateCount = candidates.length;

    t = clock();
    const ranked = rankFeed(candidates, {
      nowMs: t0, userId, tripDestinationIds: sig.trip, affinity: sig.affinity, interests: sig.interests,
      position: centre, seed: `${userId}:${gen}:${Math.floor(t0 / 3_600_000)}`,   // same within an hour of scrolling, fresh next session
    }, { exclude: new Set(seen), intent });
    timings.rank = clock() - t;
    rankedCount = ranked.length;
    coldStart = sig.trip.size === 0 && sig.affinity.size === 0 && sig.interests.length === 0 && !candidates.some((c) => c.followed);
    pageCandidates = ranked.slice(0, limit).map((r) => r.candidate);
    restIds = ranked.slice(limit).map((r) => r.candidate.id);
    seen = [...seen, ...pageCandidates.map((c) => c.id)].slice(-PAGE.seenTail);
  }

  const t = clock();
  const media = await loadMedia(supabase, storage, pageCandidates.map((c) => c.id));
  timings.media = clock() - t;
  const items = pageCandidates.map((c) => toItem(c, media.get(c.id) ?? [], { now: viewNow, viewerId: userId, position }));

  // More of this snapshot, or "refill" (empty ids) so the next request ranks again without repeating what was just shown.
  // A page that produced nothing at all ends the feed.
  const nextCursor = items.length === 0 && restIds.length === 0 ? null : encodeCursor({ ids: restIds, seen, gen, intent });
  timings.total = clock() - t0;
  console.info("[feed] feed.page", JSON.stringify({ items: items.length, rest: restIds.length, cold: coldStart, ...timings }));
  return { items, nextCursor, coldStart, ...(notice ? { notice } : {}), meta: { candidates: candidateCount, ranked: rankedCount, timings } };
}
