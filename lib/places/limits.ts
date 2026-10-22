// Every limit for place search and "where am I", in one place. Only calls that really reach an OUTSIDE service count against the daily
// limits: our own India index and anything already cached are free, so a traveller typing normally never comes near them.
//
// Guests (signed out) are counted twice: per visitor (a random cookie, hashed before it is stored) and per network (the IP address,
// hashed). The network limit is several times higher because many people in India share one mobile-network address.

export type MeteredCall = "map" | "more" | "here" | "ai" | "roads" | "explore" | "poll";

export const DAILY_LIMITS: Record<MeteredCall, { user: number; guest: number; guestNetwork: number }> = {
  /** Type-ahead from OpenStreetMap (Photon), after a pause in typing, 3+ letters, not already cached. */
  map: { user: 400, guest: 80, guestNetwork: 500 },
  /** "Search more" (Nominatim). Signed-in users share the existing place-search limit (GEOCODE_DAILY_LIMIT, default 150). */
  more: { user: 150, guest: 20, guestNetwork: 120 },
  /** Naming a position the index can only call "near …" (Nominatim reverse). Most positions are named from the index, free. */
  here: { user: 40, guest: 15, guestNetwork: 120 },
  /** Reading a trip description with the AI. Signed-in users share the existing AI import allowance (IMPORT_DAILY_LIMIT, default 40). */
  ai: { user: 40, guest: 10, guestNetwork: 60 },
  /** Road times for the fit meter: one request per SET of places (answers changing never asks again). */
  roads: { user: 200, guest: 60, guestNetwork: 300 },
  /** "Places like these": a state's notable-place list from OpenStreetMap, only when not already in the shared cache. Signed-in users share Explore's allowance (150). */
  explore: { user: 150, guest: 15, guestNetwork: 80 },
  /** Answering a group's link (saving or changing an answer). A trip also caps answers at 30 in the database. */
  poll: { user: 50, guest: 20, guestNetwork: 100 },
};

/** Bursts, per visitor per minute, for the free parts (index search, suggestions, naming from the index). Stops scripts, not people. */
export const PER_MINUTE = { search: 120, here: 20, suggest: 30, intake: 30, ai: 6, roads: 20, similar: 10, poll: 20 } as const;

/** The usage kind recorded for signed-in users (consume_quota). "more" and "ai" deliberately share the existing allowances. */
export const USER_QUOTA_KIND: Record<MeteredCall, string> = { map: "place_map", more: "geocode", here: "place_here", ai: "ai_import", roads: "intake_roads", explore: "explore", poll: "group_answer" };

const envLimit = (name: string, fallback: number) => { const n = Number(process.env[name]); return Number.isInteger(n) && n > 0 ? n : fallback; };
export const userLimit = (call: MeteredCall): number => {
  if (call === "more") return envLimit("GEOCODE_DAILY_LIMIT", DAILY_LIMITS.more.user);
  if (call === "ai") return envLimit("IMPORT_DAILY_LIMIT", DAILY_LIMITS.ai.user);
  return DAILY_LIMITS[call].user;
};
