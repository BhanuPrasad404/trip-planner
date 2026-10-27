// A traveler's standing: the badge they earned by helping OTHER travelers decide. The database counts (traveler_standing():
// different people who marked a post "helped me decide" or added its place to their trip; one person counts once, never yourself).
// This file names the badges and decides the steps, in one place, so every screen says the same thing.

export type TierId = "helpful" | "trusted" | "guide" | "legend";
export type Tier = { id: TierId; name: string; /** Travelers helped needed to earn it. */ at: number; /** What it means, in one plain line. */ meaning: string };

/** Few people reach the top on purpose: a badge everyone has means nothing. */
export const TIERS: readonly Tier[] = [
  { id: "helpful", name: "Helpful traveler", at: 5, meaning: "Their posts have helped 5 or more travelers decide." },
  { id: "trusted", name: "Trusted traveler", at: 25, meaning: "25 or more travelers used their posts to plan." },
  { id: "guide", name: "Trail guide", at: 100, meaning: "100 or more travelers planned with their posts." },
  { id: "legend", name: "Trail legend", at: 500, meaning: "One of the very few: 500 or more travelers helped." },
] as const;

/** A place badge ("Local voice: Araku Valley") needs this many different travelers helped by posts from THAT place. */
export const LOCAL_VOICE_AT = 5;

export type StandingRow = {
  author_id: string; helped: number | string | null; posts: number | string | null; followers: number | string | null; following: number | string | null;
  top_destination_id: string | null; top_destination_name: string | null; top_destination_helped: number | string | null;
};

/** What the screens get. `followers`/`following` are null when the person hides their follow lists. */
export type Standing = {
  helped: number;
  posts: number;
  followers: number | null;
  following: number | null;
  tier: TierId | null;
  /** "Local voice" for one place, when earned. */
  place: { id: string; name: string; helped: number } | null;
};

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0; };

export function tierFor(helped: number): Tier | null {
  let best: Tier | null = null;
  for (const t of TIERS) if (helped >= t.at) best = t;
  return best;
}

export const tierById = (id: TierId | null | undefined): Tier | null => TIERS.find((t) => t.id === id) ?? null;

/** The next badge and how far away it is: "8 more travelers to Trusted traveler". Null at the top. */
export function nextStep(helped: number): { tier: Tier; remaining: number; progress: number } | null {
  const next = TIERS.find((t) => helped < t.at);
  if (!next) return null;
  const prevAt = [...TIERS].reverse().find((t) => t.at <= helped)?.at ?? 0;
  return { tier: next, remaining: next.at - helped, progress: Math.min(1, Math.max(0, (helped - prevAt) / (next.at - prevAt))) };
}

export function toStanding(r: StandingRow): Standing {
  const helped = n(r.helped);
  const placeHelped = n(r.top_destination_helped);
  return {
    helped, posts: n(r.posts),
    followers: r.followers == null ? null : n(r.followers),
    following: r.following == null ? null : n(r.following),
    tier: tierFor(helped)?.id ?? null,
    place: r.top_destination_id && r.top_destination_name && placeHelped >= LOCAL_VOICE_AT ? { id: r.top_destination_id, name: r.top_destination_name, helped: placeHelped } : null,
  };
}

/** The short form a feed card carries: only what a card shows. */
export type BadgeDTO = { tier: TierId | null; place: string | null; helped: number };
export const badgeOf = (s: Standing | null | undefined): BadgeDTO | null => (s && (s.tier || s.place) ? { tier: s.tier, place: s.place?.name ?? null, helped: s.helped } : null);
