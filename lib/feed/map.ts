// Database rows → ranking candidates → the small payload the screen needs. Pure, so it is tested without a database.
import { freshnessOf } from "@/lib/social/freshness";
import { haversineM } from "@/lib/geo";
import { CONDITION_IDS, CROWD_LEVELS, VIBE_IDS, type CrowdLevel } from "./experience";
import type { FeedCandidate, PostKind } from "./types";

/** One row of feed_items()/feed_candidates(). */
export type FeedRow = {
  pools?: string[] | null;
  id: string; author_id: string; username: string; display_name: string | null;
  destination_id: string; destination_name: string; destination_slug: string; destination_posts: number;
  kind: string; caption: string | null; place_name: string; lat: number; lng: number; location_precision: string;
  captured_at: string; created_at: string; comments_allowed: string; duration_s: number | string | null;
  crowd: string | null; conditions: string[] | null; vibes: string[] | null; tip: string | null; verified_area: boolean;
  likes: number; comments: number; saves: number; shares: number; helpful: number; trip_adds: number; impressions: number; plays: number; completions: number; skips: number; watch_ms: number | string;
  followed: boolean; liked: boolean; saved: boolean; helped: boolean; seen_at: string | null; seen_pct: number | null;
};

const KINDS: PostKind[] = ["photo", "video", "report"];
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function rowToCandidate(r: FeedRow): FeedCandidate | null {
  if (!KINDS.includes(r.kind as PostKind) || !r.id || !r.destination_id) return null;   // a malformed row never reaches the ranker
  return {
    id: r.id, authorId: r.author_id, username: r.username, displayName: r.display_name,
    destinationId: r.destination_id, destinationName: r.destination_name, destinationSlug: r.destination_slug, destinationPosts: num(r.destination_posts),
    kind: r.kind as PostKind, caption: r.caption, placeName: r.place_name, lat: num(r.lat), lng: num(r.lng),
    locationPrecision: r.location_precision === "exact" ? "exact" : "approx",
    capturedAt: r.captured_at, createdAt: r.created_at,
    commentsAllowed: r.comments_allowed === "off" ? "off" : r.comments_allowed === "followers" ? "followers" : "everyone",
    durationS: r.duration_s == null ? null : num(r.duration_s),
    crowd: r.crowd && (CROWD_LEVELS as readonly string[]).includes(r.crowd) ? (r.crowd as CrowdLevel) : null,
    conditions: (r.conditions ?? []).filter((x) => (CONDITION_IDS as readonly string[]).includes(x)),
    vibes: (r.vibes ?? []).filter((x) => (VIBE_IDS as readonly string[]).includes(x)),
    tip: r.tip, fromArea: !!r.verified_area,
    counters: { likes: num(r.likes), comments: num(r.comments), saves: num(r.saves), shares: num(r.shares), helpful: num(r.helpful), tripAdds: num(r.trip_adds), impressions: num(r.impressions), plays: num(r.plays), completions: num(r.completions), skips: num(r.skips), watchMs: num(r.watch_ms) },
    pools: r.pools ?? [], followed: !!r.followed, liked: !!r.liked, saved: !!r.saved, helped: !!r.helped, seenAt: r.seen_at, seenPct: r.seen_pct,
  };
}

export type MediaDTO = { type: "image" | "video"; url: string; posterUrl: string | null; width: number | null; height: number | null; durationS: number | null };

/** The ONLY shape the screen receives: no scores, no internal ids of pools, no counters it does not display. */
export type FeedItemDTO = {
  id: string;
  kind: PostKind;
  caption: string | null;
  placeName: string;
  destination: { id: string; name: string; slug: string };
  author: { username: string; displayName: string | null };
  media: MediaDTO[];
  counts: { likes: number; comments: number; saves: number; helpful: number; tripAdds: number };
  me: { liked: boolean; saved: boolean; helped: boolean };
  /** What the traveler said about the place. `fromArea` = the phone was near the destination when posting (not proof). */
  experience: { crowd: CrowdLevel | null; conditions: string[]; vibes: string[]; tip: string | null; fromArea: boolean };
  freshness: { label: string; state: string; dot: "green" | "amber" | "grey"; usableAsCurrent: boolean };
  location: { lat: number; lng: number; precision: "exact" | "approx"; distanceKm: number | null };
  canComment: boolean;
  /** True when the viewer wrote it: the screen then offers Delete and "who liked this", not Report or Block. */
  isMine: boolean;
  createdAt: string;
};

export function toItem(c: FeedCandidate, media: MediaDTO[], opts: { now: Date; viewerId: string; position: { lat: number; lng: number } | null }): FeedItemDTO {
  const f = freshnessOf(c.createdAt, c.capturedAt, opts.now);
  const canComment = c.commentsAllowed === "everyone" || (c.commentsAllowed === "followers" && (c.followed || c.authorId === opts.viewerId));
  return {
    id: c.id, kind: c.kind, caption: c.caption, placeName: c.placeName,
    destination: { id: c.destinationId, name: c.destinationName, slug: c.destinationSlug },
    author: { username: c.username, displayName: c.displayName },
    media,
    counts: { likes: c.counters.likes, comments: c.counters.comments, saves: c.counters.saves, helpful: c.counters.helpful, tripAdds: c.counters.tripAdds },
    me: { liked: c.liked, saved: c.saved, helped: c.helped },
    experience: { crowd: c.crowd, conditions: c.conditions, vibes: c.vibes, tip: c.tip, fromArea: c.fromArea },
    freshness: { label: f.label, state: f.state, dot: f.dot, usableAsCurrent: f.usableAsCurrent },
    location: { lat: c.lat, lng: c.lng, precision: c.locationPrecision, distanceKm: opts.position ? Math.round((haversineM(opts.position, c) / 1000) * 10) / 10 : null },
    canComment, isMine: c.authorId === opts.viewerId, createdAt: c.createdAt,
  };
}
