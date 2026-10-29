// The ONE shape of an opening-hours answer, shared by Search, Explore, "Plan it for me", "On your way", Trip Check and Live mode, so the
// same place gets the same answer everywhere. Types and plain helpers only: safe in the browser (the parser stays on the server,
// lib/server/hours-resolver.ts).
import type { Attraction, AttractionList } from "./attractions";

/**
 *   known           a readable schedule for the visit date, from a source somebody checked (a trip member, a curated source, or map
 *                   data a mapper re-checked recently)
 *   partial         part of the day can't be read (a comment, an open-ended time), or only service (darshan / prayer) times are known
 *   conflicting     sources of the same standing disagree: both are shown, neither is picked
 *   unverified      a schedule exists but nobody checked it recently, or it depends on public holidays we can't check, or can't be read
 *   open_access     usually open ground (a beach, a viewpoint, a peak) and no hours are recorded
 *   not_applicable  a city, a town, a district or a valley: no single opening time of its own
 *   none            nothing is recorded
 */
export type HoursStatus = "known" | "partial" | "conflicting" | "unverified" | "open_access" | "not_applicable" | "none";
/** Why the answer isn't simply "known". */
export type HoursWhy = "missing" | "conflicting" | "unreadable" | "not_verified" | "holiday_rule" | "no_own_hours" | "service_times_only" | "part_unknown";

export type HoursSourceKind = "member" | "curated" | "osm";
export type HoursSource = {
  kind: HoursSourceKind;
  /** "A trip member", "OpenStreetMap", or a curated source's name. */
  name: string;
  /** "osm/way/123", a page address, or null. */
  ref: string | null;
  /** The date of THIS information: when a member confirmed it, a curated entry was read, or a mapper last checked it; else the data's date. */
  date: string | null;
  /** True when a person checked these hours (a member, a curated entry, a mapper's recent check date). */
  checked: boolean;
};

/** [fromMs, toMs, unknown] in UTC (the same as lib/travel/hours-intervals.ts). */
export type DayInterval = [number, number, boolean];

export type HoursAnswer = {
  place: string;
  /** The visit date, YYYY-MM-DD in India time. */
  date: string;
  status: HoursStatus;
  why: HoursWhy | null;
  /** One or two plain sentences, with the place's own name. Never just "hours not available". */
  message: string;
  /** The schedule exactly as the source writes it (never rewritten). */
  schedule: string | null;
  serviceTimes: string | null;
  /** The visit date's opening intervals (India time), or null when they can't be worked out honestly. */
  day: { intervals: DayInterval[]; text: string } | null;
  source: HoursSource | null;
  /** Every source that was looked at, with its date: so "nothing found" says where we looked. */
  checked: { name: string; date: string | null }[];
  /** Closed days, holiday rules, notes as written. */
  exceptions: string[];
  /** What a schedule does not promise (queues, tickets, special darshan, festivals), or how open ground is usually used. */
  access: string;
  /** The place's own page: a link only (we never read it). */
  officialLink: { url: string; label: string } | null;
  /** Other sources that say something different, with where they come from. Shown, never silently dropped. */
  conflicts: { source: HoursSource; schedule: string }[];
};

/** A place in or around a town, with its own hours on the visit date (GET /api/places/around). */
export type AroundItem = Omit<Attraction, "hoursRows"> & { hours: HoursAnswer };
export type AroundAnswer = { parent: AttractionList["parent"]; radiusKm: number; items: AroundItem[]; areas: Omit<Attraction, "hoursRows">[]; dropped: AttractionList["dropped"]; date: string };

/** Driving alerts and "open/closed" labels may only use answers in this state. */
export const hoursAreKnown = (a: Pick<HoursAnswer, "status" | "day">) => a.status === "known" && !!a.day;
