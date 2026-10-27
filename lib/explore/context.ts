// What is the traveller doing RIGHT NOW, as far as the trip tells us? Pure: no clock, no database (today is passed in).
// Explore uses it to decide WHERE to look:
//   planned  → along the whole planned route (start → the stops still to do → the end), and round each stop
//   active   → along what is LEFT of the route, from where you are (if you allowed your position) or your last finished stop
//   staying  → nothing left to do on the plan (or no route at all): round the place you are at
//   none     → no trip, or a finished / called-off one: ordinary search, nothing about a route is claimed
// Nothing here changes the trip.
import { tripEndPoint, type TripEndMode } from "@/lib/trip/end";
import { tripState } from "@/lib/trip-state";

export type ExploreMode = "none" | "planned" | "active" | "staying";
export type Anchor = { lat: number; lng: number; label: string };
export type CtxStop = Anchor & { id: string };

export type ExploreContext = {
  mode: ExploreMode;
  /** The points the road runs through, in order. Fewer than 2 means there is no corridor to search along. */
  anchors: Anchor[];
  /** Stops still to do, in the order they are planned. */
  remaining: CtxStop[];
  /** Where to look round when there is no corridor (staying) or as a fallback. */
  focus: Anchor | null;
  /** The traveller's own position, only when they allowed it. */
  position: { lat: number; lng: number } | null;
  /** One plain line saying what the list is about. */
  headline: string;
  /** Honest notes about what the list is NOT (dates passed, no GPS, no stops yet…). */
  notes: string[];
};

type TripLike = {
  start_date: string | null; num_days: number; end_mode?: TripEndMode | null;
  start_city: string | null; start_lat: number | null; start_lng: number | null;
  dest_name: string | null; dest_lat: number | null; dest_lng: number | null;
  resumed_at?: string | null; closed_at?: string | null; name?: string;
};
type PlaceLike = { id: string; name: string; lat: number; lng: number; day_number: number | null; sequence_order: number | null; status?: "planned" | "done" | "skipped" | null };

const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const valid = (a: { lat: unknown; lng: unknown }) => ok(a.lat) && ok(a.lng) && Math.abs(a.lat as number) <= 90 && Math.abs(a.lng as number) <= 180;
const stamp = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const order = (a: PlaceLike, b: PlaceLike) => (a.day_number ?? 0) - (b.day_number ?? 0) || (a.sequence_order ?? 0) - (b.sequence_order ?? 0);

export function exploreContext(input: { trip: TripLike | null; places: PlaceLike[]; todayISO: string; position?: { lat: number; lng: number } | null }): ExploreContext {
  const { trip, places, todayISO } = input;
  const position = input.position && valid(input.position) ? { lat: input.position.lat, lng: input.position.lng } : null;
  const none = (headline: string, notes: string[] = []): ExploreContext => ({ mode: "none", anchors: [], remaining: [], focus: null, position, headline, notes });
  if (!trip) return none("Discover places anywhere in India");
  if (stamp(trip.closed_at)) return none("Discover places anywhere in India", ["This trip is over, so Explore is not tied to it."]);

  const scheduled = places.filter((p) => p.day_number !== null && valid(p)).sort(order);
  const remaining: CtxStop[] = scheduled.filter((p) => (p.status ?? "planned") === "planned").map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, label: p.name }));
  const lastDone = [...scheduled].reverse().find((p) => p.status === "done");
  const start: Anchor | null = valid({ lat: trip.start_lat, lng: trip.start_lng }) ? { lat: trip.start_lat as number, lng: trip.start_lng as number, label: trip.start_city?.trim() || "Your start" } : null;
  const endRaw = tripEndPoint(trip);
  const end: Anchor | null = endRaw && valid(endRaw) ? endRaw : null;

  const state = tripState(trip, todayISO);
  const running = stamp(trip.resumed_at) || state === "active";
  const notes: string[] = [];
  if (!running && state === "completed") notes.push("Your planned dates have passed. These suggestions are for when you go, not for the old dates.");

  if (running) {
    const here: Anchor | null = position ? { ...position, label: "Where you are" } : lastDone ? { lat: lastDone.lat, lng: lastDone.lng, label: lastDone.name } : start;
    if (!position) notes.push("Your position isn't shared, so this starts from your last finished stop. Share it for results ahead of where you really are.");
    if (remaining.length === 0) {
      const focus = here ?? end;
      return { mode: "staying", anchors: [], remaining, focus, position, headline: focus ? `Around ${focus.label}` : "Discover places anywhere in India", notes: focus ? notes.filter((n) => !n.startsWith("Your position")) : notes };
    }
    const anchors = [...(here ? [here] : []), ...remaining, ...(end && !sameSpot(end, remaining[remaining.length - 1]) ? [end] : [])];
    const last = remaining[remaining.length - 1];
    return { mode: "active", anchors, remaining, focus: here, position, headline: `Ahead on your route to ${end && trip.end_mode !== "start" ? end.label : last.label}`, notes };
  }

  // Not started (or dates over and not resumed): the whole planned road.
  const anchors = [...(start ? [start] : []), ...remaining, ...(end && !(remaining.length && sameSpot(end, remaining[remaining.length - 1])) ? [end] : [])];
  const focus = remaining[0] ?? end ?? start;
  if (anchors.length < 2) {
    if (!focus) return none("Discover places anywhere in India", ["This trip has no places or start yet, so there is no route to search along."]);
    return { mode: "planned", anchors: [], remaining, focus, position, headline: `Around ${focus.label}`, notes: [...notes, "Add a start and a stop to see places along your route."] };
  }
  const to = end && trip.end_mode !== "start" ? end.label : remaining.length ? remaining[remaining.length - 1].label : anchors[anchors.length - 1].label;
  return { mode: "planned", anchors, remaining, focus, position, headline: `Along your route to ${to}`, notes };
}

const sameSpot = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.abs(a.lat - b.lat) < 0.002 && Math.abs(a.lng - b.lng) < 0.002;
