// The outbox: changes made with no signal are kept on THIS phone, shown at once, and sent when the connection is back.
// It generalises the visited/skipped queue to the other actions a traveller loses without internet. Pure: no React, no storage access.
//
// Privacy: the outbox belongs to ONE person on ONE trip — its storage key contains both ids — so on a shared phone nobody ever sees
// or sends someone else's waiting changes (use-outbox.ts deletes other people's outboxes). Only the person's own edits to their own
// trip are kept: no positions, no other people's data, no photos.
import { withVote } from "@/lib/optimistic";
import { JOURNEY_KINDS, type JourneyKind, type MetaValue } from "@/lib/trip/journey";
import type { VoteSummary } from "@/lib/votes";

export type VisitStatus = "done" | "skipped" | "planned";
export type OutboxAction =
  /** `expected`: the status this phone last saw (the server refuses, with a 409, if the stop has moved on). `eventId`: one id per change, so a retry is harmless. Both absent on changes saved by an older app version. */
  | { kind: "status"; placeId: string; status: VisitStatus; expected?: VisitStatus; eventId?: string }
  /** "I've arrived" (true) / "not here yet" (false). Arriving never marks the stop visited. */
  | { kind: "arrive"; placeId: string; arrived: boolean; eventId?: string; /** How it was noticed: the phone's location (with its accuracy) or said by hand. */ source?: "gps" | "manual"; accuracyM?: number }
  /** A real event on the journey (left, paused, rested...). Every one is kept and sent: unlike a status, two of them never replace each other. */
  | { kind: "journey"; tripId: string; event: JourneyKind; eventId: string; source: "gps" | "manual"; accuracyM?: number; placeId?: string; placeName?: string; meta?: Record<string, MetaValue> }
  | { kind: "vote"; placeId: string; vote: -1 | 0 | 1 }
  | { kind: "move"; placeId: string; day: number | null }
  | { kind: "relocate"; placeId: string; lat: number; lng: number; address: string | null }
  | { kind: "report"; clientId: string; placeName: string; lat: number; lng: number; tags: string[]; note: string | null };
/** `label`: the stop's name, for messages ("Golconda Fort couldn't be updated"). */
export type OutboxItem = OutboxAction & { at: number; label?: string };
export type SendResult = "ok" | "retry" | "failed";

export const OUTBOX_MAX_AGE_MS = 7 * 24 * 3_600_000;
export const OUTBOX_MAX_ITEMS = 50;
export const OUTBOX_PREFIX = "tm:outbox:";
export const outboxKey = (userId: string, tripId: string) => `${OUTBOX_PREFIX}${userId}:${tripId}`;
/** The old visited/skipped queue: saved WITHOUT a user, so on a shared phone it could be anyone's. Never read, only removed. */
export const LEGACY_VISITS_PREFIX = "tm:visits:";
export const OFFLINE_SAVED_TEXT = "Saved on your phone — will send when online.";

/** One waiting change per stop and kind: the newest replaces an older one (done, then undo, is just "planned"). */
export const itemKey = (a: OutboxAction): string => (a.kind === "report" ? `report:${a.clientId}` : a.kind === "journey" ? `journey:${a.eventId}` : `${a.kind}:${a.placeId}`);

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const isEventId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v);
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

function valid(x: unknown): x is OutboxItem {
  const v = x as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || !isNum(v.at, 0, Number.MAX_SAFE_INTEGER)) return false;
  if (v.label !== undefined && !isStr(v.label, 200)) return false;
  switch (v.kind) {
    case "status": return isId(v.placeId) && (v.status === "done" || v.status === "skipped" || v.status === "planned")
      && (v.expected === undefined || v.expected === "done" || v.expected === "skipped" || v.expected === "planned") && (v.eventId === undefined || isEventId(v.eventId));
    case "journey": return isId(v.tripId) && typeof v.event === "string" && (JOURNEY_KINDS as readonly string[]).includes(v.event) && isEventId(v.eventId) && (v.source === "gps" || v.source === "manual")
      && (v.accuracyM === undefined || isNum(v.accuracyM, 0, 100_000)) && (v.placeName === undefined || isStr(v.placeName, 120)) && (v.placeId === undefined || isId(v.placeId))
      && (v.meta === undefined || (!!v.meta && typeof v.meta === "object" && !Array.isArray(v.meta) && Object.keys(v.meta).length <= 8 && Object.values(v.meta as Record<string, unknown>).every((x) => (typeof x === "string" && x.length <= 200) || (typeof x === "number" && Number.isFinite(x)) || typeof x === "boolean")));
    case "arrive": return isId(v.placeId) && typeof v.arrived === "boolean" && (v.eventId === undefined || isEventId(v.eventId))
      && (v.source === undefined || v.source === "gps" || v.source === "manual") && (v.accuracyM === undefined || isNum(v.accuracyM, 0, 100_000));
    case "vote": return isId(v.placeId) && (v.vote === -1 || v.vote === 0 || v.vote === 1);
    case "move": return isId(v.placeId) && (v.day === null || (Number.isInteger(v.day) && isNum(v.day, 1, 60)));
    case "relocate": return isId(v.placeId) && isNum(v.lat, -90, 90) && isNum(v.lng, -180, 180) && (v.address === null || isStr(v.address, 300));
    case "report": return isId(v.clientId) && isStr(v.placeName, 120) && (v.placeName as string).trim().length > 0 && isNum(v.lat, -90, 90) && isNum(v.lng, -180, 180)
      && Array.isArray(v.tags) && v.tags.length <= 6 && v.tags.every((t) => isStr(t, 40)) && (v.note === null || isStr(v.note, 280)) && (v.tags.length > 0 || v.note !== null);
    default: return false;
  }
}

/** Read a saved outbox. Damaged data, unknown kinds and changes older than 7 days are dropped; nothing here can break the page. */
export function parseOutbox(raw: string | null, now: number): OutboxItem[] {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw) as { items?: unknown };
    if (!Array.isArray(j?.items)) return [];
    return j.items.filter((x): x is OutboxItem => valid(x) && now - x.at <= OUTBOX_MAX_AGE_MS && x.at <= now + 60_000).slice(-OUTBOX_MAX_ITEMS);
  } catch {
    return [];
  }
}

/** Add a change. The newest per stop/kind wins; beyond 50 waiting changes the OLDEST are dropped (and returned, to say so). */
export function addToOutbox(items: OutboxItem[], next: OutboxItem): { items: OutboxItem[]; dropped: OutboxItem[] } {
  const k = itemKey(next);
  // Replacing a waiting status change keeps what the FIRST of them expected: the server's state when the person began, not the
  // screen's (which already showed the waiting change).
  const older = next.kind === "status" ? items.find((i) => itemKey(i) === k) : undefined;
  const carried: OutboxItem = next.kind === "status" && older?.kind === "status" && older.expected !== undefined ? { ...next, expected: older.expected } : next;
  const all = [...items.filter((i) => itemKey(i) !== k), carried];
  const over = Math.max(0, all.length - OUTBOX_MAX_ITEMS);
  return { items: all.slice(over), dropped: all.slice(0, over) };
}
export const removeFromOutbox = (items: OutboxItem[], done: OutboxItem): OutboxItem[] => items.filter((i) => !(itemKey(i) === itemKey(done) && i.at === done.at));

/** The request that sends one waiting change. */
export function requestFor(i: OutboxItem): { url: string; init: RequestInit } {
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  switch (i.kind) {
    // `at` is when the person acted (this phone's clock), not when the change is finally sent.
    case "status": return { url: `/api/places/${i.placeId}`, init: json("PATCH", { status: i.status, at: new Date(i.at).toISOString(), ...(i.expected ? { expected: i.expected } : {}), ...(i.eventId ? { event_id: i.eventId } : {}) }) };
    case "journey": return { url: `/api/trips/${i.tripId}/events`, init: json("POST", { kind: i.event, client_event_id: i.eventId, at: new Date(i.at).toISOString(), source: i.source, ...(i.accuracyM !== undefined ? { accuracy_m: i.accuracyM } : {}), ...(i.placeId ? { place_id: i.placeId } : {}), ...(i.placeName ? { place_name: i.placeName } : {}), ...(i.meta && Object.keys(i.meta).length ? { meta: i.meta } : {}) }) };
    case "arrive": return { url: `/api/places/${i.placeId}`, init: json("PATCH", { arrived: i.arrived, at: new Date(i.at).toISOString(), ...(i.eventId ? { event_id: i.eventId } : {}), ...(i.source ? { source: i.source } : {}), ...(i.accuracyM !== undefined ? { accuracy_m: i.accuracyM } : {}) }) };
    case "vote": return { url: `/api/places/${i.placeId}/vote`, init: json("POST", { vote: i.vote }) };
    case "move": return { url: `/api/places/${i.placeId}`, init: json("PATCH", { day_number: i.day }) };
    case "relocate": return { url: `/api/places/${i.placeId}`, init: json("PATCH", { lat: i.lat, lng: i.lng, address: i.address }) };
    case "report": return { url: "/api/reports", init: json("POST", { place_name: i.placeName, lat: i.lat, lng: i.lng, tags: i.tags, note: i.note, photo_path: null }) };
  }
}

/** One id for one change. Random, never derived from anything about the person. */
export function newEventId(rnd: () => number = Math.random): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  let out = "";
  for (let n = 0; n < 24; n++) out += Math.floor(rnd() * 36).toString(36);
  return out;
}

/**
 * "retry" = the network or the server had a problem, the sign-in needs refreshing, or a daily limit was hit: keep it and try later.
 * "failed" = refused for good (the stop was removed, you were removed, the change is invalid): drop it and say so.
 */
export function classify(status: number | null): SendResult {
  if (status === null) return "retry";
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 408 || status === 429 || status >= 500) return "retry";
  return "failed";
}

export async function sendItem(i: OutboxItem, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const { url, init } = requestFor(i);
  try {
    return classify((await fetchImpl(url, init)).status);
  } catch {
    return "retry";
  }
}

/** Show the waiting changes on top of the trip's stops (status, day, pin), so the screen matches what the person did. */
export function applyOutboxToPlaces<T extends { id: string; status?: string | null; arrived_at?: string | null; day_number?: number | null; sequence_order?: number | null; lat: number; lng: number; address?: string | null }>(places: T[], items: OutboxItem[]): T[] {
  if (items.length === 0) return places;
  const by = new Map<string, OutboxItem[]>();
  for (const i of items) if (i.kind !== "report" && i.kind !== "vote" && i.kind !== "journey") by.set(i.placeId, [...(by.get(i.placeId) ?? []), i]);
  if (by.size === 0) return places;
  const lastOrder = (day: number) => Math.max(0, ...places.filter((p) => p.day_number === day).map((p) => p.sequence_order ?? 0));
  return places.map((p) => {
    const mine = by.get(p.id);
    if (!mine) return p;
    let q = { ...p };
    for (const i of mine) {
      if (i.kind === "status") q = { ...q, status: i.status };
      if (i.kind === "arrive") q = { ...q, arrived_at: i.arrived ? new Date(i.at).toISOString() : null };
      if (i.kind === "move" && q.day_number !== i.day) q = { ...q, day_number: i.day, sequence_order: i.day === null ? null : lastOrder(i.day) + 1 };
      if (i.kind === "relocate") q = { ...q, lat: i.lat, lng: i.lng, address: i.address };
    }
    return q;
  });
}

/** Show my waiting votes on top of the trip's vote counts. */
export function applyOutboxToVotes(votes: Record<string, VoteSummary>, items: OutboxItem[]): Record<string, VoteSummary> {
  const mine = items.filter((i): i is Extract<OutboxItem, { kind: "vote" }> => i.kind === "vote");
  if (mine.length === 0) return votes;
  const out = { ...votes };
  for (const v of mine) out[v.placeId] = withVote(out[v.placeId], v.vote);
  return out;
}

/** Which saved keys must be removed when `userId` uses this phone: other people's outboxes and the old unowned queue. */
export function foreignKeys(keys: readonly string[], userId: string): string[] {
  return keys.filter((k) => k.startsWith(LEGACY_VISITS_PREFIX) || (k.startsWith(OUTBOX_PREFIX) && !k.startsWith(`${OUTBOX_PREFIX}${userId}:`)));
}

/** How many changes `userId` has waiting on this phone, across all trips (for the sign-out warning). */
export function countWaiting(store: { key(i: number): string | null; length: number; getItem(k: string): string | null }, userId: string, now: number): number {
  let n = 0;
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(`${OUTBOX_PREFIX}${userId}:`)) n += parseOutbox(store.getItem(k), now).length;
  }
  return n;
}

export function describe(i: OutboxItem): string {
  const name = i.label ?? (i.kind === "report" ? i.placeName : "A stop");
  switch (i.kind) {
    case "status": return `${name}: marked ${i.status === "planned" ? "not visited" : i.status}`;
    case "journey": return `Journey: ${i.event.replace("_", " ")}`;
    case "arrive": return `${name}: ${i.arrived ? "arrived" : "not here yet"}`;
    case "vote": return `${name}: your vote`;
    case "move": return `${name}: moved to ${i.day === null ? "Ideas" : `Day ${i.day}`}`;
    case "relocate": return `${name}: pin moved`;
    case "report": return `${name}: your update`;
  }
}
