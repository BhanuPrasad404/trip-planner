// Trip Readiness: "do we know enough to do what the traveller is about to do?" — from explicit rules, never a guessed score.
// Each rule says what is missing, WHY it matters, WHICH features it limits, how serious it is for THIS action, and the next step.
// Missing information is never invented or silently defaulted: a trip with no dates is a perfectly good draft; it only becomes
// a problem when the traveller asks for something that needs the dates.
import { isRealISODate } from "@/lib/dates";

export type ReadinessAction = "save" | "plan" | "check-departure" | "start-navigation" | "find-nearby";
export type Feature = "season_scores" | "weather" | "opening_hours" | "arrival_times" | "route" | "navigation" | "nearby" | "day_labels";
export type Severity = "blocker" | "important" | "info";
export type NextStep = "set-dates" | "set-departure" | "set-start" | "add-places" | "plan-trip" | "enable-location" | "choose-place" | "enter-hours" | "review-times" | "none";

export type ReadinessInput = {
  action: ReadinessAction;
  todayISO: string;
  trip: { start_date: string | null; num_days: number; start_lat: number | null; start_lng: number | null; dest_lat?: number | null; dest_lng?: number | null };
  places: { id: string; name: string; day_number: number | null; sequence_order?: number | null; arrival_time: string | null; drive_minutes: number | null; hours?: string | null }[];
  /** What the device says. null = never asked. */
  device?: { permission: "granted" | "denied" | "prompt" | "unavailable" | "unknown"; hasFix: boolean; accurate: boolean } | null;
  /** The departure the traveller is checking (a what-if, not saved on the trip). */
  departure?: { date: string | null; time: string | null } | null;
};

export type ReadinessItem = {
  id: string;
  field: string;
  title: string;
  /** Why this matters, in one sentence. */
  why: string;
  affects: Feature[];
  severity: Severity;
  /** True when the requested action cannot sensibly go ahead without it. */
  blocksAction: boolean;
  next: { step: NextStep; label: string };
  /** The sentence shown to the traveller. */
  message: string;
};

export type ReadinessResult = {
  action: ReadinessAction;
  canProceed: boolean;
  items: ReadinessItem[];
  counts: { blocker: number; important: number; info: number };
  /** Features that cannot be evaluated reliably until the items above are resolved. */
  unavailable: Feature[];
  headline: string;
};

type Rule = { item: Omit<ReadinessItem, "severity" | "blocksAction">; base: Exclude<Severity, "blocker">; blocksFor: ReadinessAction[] };

export function checkReadiness(input: ReadinessInput): ReadinessResult {
  const { action, trip, places, device, departure, todayISO } = input;
  const rules: Rule[] = [];
  const add = (r: Rule) => rules.push(r);
  const scheduled = places.filter((p) => p.day_number !== null);
  const effectiveDate = isRealISODate(departure?.date) ? departure!.date : isRealISODate(trip.start_date) ? trip.start_date : null;
  const deviceUsable = !!device && device.hasFix && device.accurate;
  const hasDestination = trip.dest_lat != null && trip.dest_lng != null;

  // Dates. A trip without them is fine to save and plan; date-based checks are simply unavailable.
  if (!isRealISODate(trip.start_date)) {
    add({
      base: "important", blocksFor: [],
      item: {
        id: "no-dates", field: "start_date", title: "Trip dates aren't set",
        why: "The season, weather, destination opening days and day labels all depend on the date you travel.",
        affects: ["season_scores", "weather", "opening_hours", "day_labels"],
        next: { step: "set-dates", label: "Set trip dates" },
        message: "Your trip dates aren't set yet. Set them to check destination opening hours, weather forecasts, estimated arrival times and travel conditions.",
      },
    });
  }

  if (action === "check-departure") {
    if (!effectiveDate) {
      add({ base: "important", blocksFor: ["check-departure"], item: { id: "no-departure-date", field: "departure.date", title: "No departure date", why: "Opening hours and weather depend on the day you leave.", affects: ["opening_hours", "arrival_times", "weather"], next: { step: "set-departure", label: "Choose a departure date" }, message: "Choose the date you plan to leave so we can check opening hours for that day." } });
    }
    if (!departure?.time) {
      add({ base: "important", blocksFor: ["check-departure"], item: { id: "no-departure-time", field: "departure.time", title: "No departure time", why: "Without it we can only say how long each leg takes, not what time you arrive.", affects: ["arrival_times", "opening_hours"], next: { step: "set-departure", label: "Choose a departure time" }, message: "Choose the time you plan to leave. Without it we won't claim an exact arrival time." } });
    }
  } else if (action === "plan") {
    add({ base: "info", blocksFor: [], item: { id: "plan-no-departure-time", field: "departure.time", title: "Departure time isn't part of the plan", why: "Plans show durations and estimated arrival times from the day's start, not from your real departure.", affects: ["arrival_times"], next: { step: "set-departure", label: "Check a departure time" }, message: "Arrival times in the plan assume a morning start. Use the departure check to test the time you will really leave." } });
  }

  // Where from. Navigation can start from the device; planning and arrival maths need a start point.
  if (trip.start_lat == null || trip.start_lng == null) {
    const blocks: ReadinessAction[] = action === "start-navigation" ? (deviceUsable ? [] : ["start-navigation"]) : ["plan", "check-departure"];
    add({ base: "important", blocksFor: blocks, item: { id: "no-start-point", field: "start", title: "No start point", why: "Distances, driving times and arrival times are measured from where you start.", affects: ["route", "arrival_times", "navigation"], next: { step: "set-start", label: "Choose where you start" }, message: deviceUsable && action === "start-navigation" ? "No start point is saved, so we'll use where you are now." : "Choose where the trip starts so we can measure real driving times." } });
  }

  // Where to.
  if (places.length === 0 && !hasDestination) {
    add({ base: "important", blocksFor: ["plan", "check-departure", "start-navigation"], item: { id: "nothing-to-go-to", field: "places", title: "Nowhere to go yet", why: "There is no place or destination to plan or navigate to.", affects: ["route", "navigation", "arrival_times"], next: { step: "add-places", label: "Add a place" }, message: "Add at least one place or a destination first." } });
  }

  // Driving times (needed to say when you arrive).
  if (action === "check-departure" && scheduled.length > 0 && scheduled.some((p) => p.drive_minutes === null)) {
    add({ base: "important", blocksFor: ["check-departure"], item: { id: "no-drive-times", field: "drive_minutes", title: "Driving times aren't calculated", why: "Arrival times are built from the driving time between stops.", affects: ["arrival_times", "opening_hours"], next: { step: "plan-trip", label: "Plan my trip" }, message: "Some stops have no driving time yet. Use Plan my trip to calculate real road times, then check your departure." } });
  }

  // Opening hours: a fact we usually don't have. Say so; never treat it as "closed".
  if ((action === "plan" || action === "check-departure" || action === "start-navigation") && scheduled.length > 0) {
    const unknown = scheduled.filter((p) => !p.hours).length;
    if (unknown > 0) {
      add({ base: "info", blocksFor: [], item: { id: "hours-unverified", field: "hours", title: "Opening hours unverified", why: "We only warn about closing times we actually know.", affects: ["opening_hours"], next: { step: "enter-hours", label: "Add hours you know" }, message: `${unknown} of ${scheduled.length} ${scheduled.length === 1 ? "stop has" : "stops have"} no opening hours, so we can't say whether ${unknown === 1 ? "it" : "they"} will be open. Add the hours you know, or check before you go.` } });
    }
  }

  // Location permission and quality.
  if ((action === "start-navigation" || action === "find-nearby") && device && (device.permission === "denied" || device.permission === "unavailable")) {
    add({ base: "important", blocksFor: [], item: { id: "location-off", field: "device.location", title: device.permission === "denied" ? "Location is blocked" : "Location isn't available", why: "Nearby suggestions and navigation work from where you are.", affects: ["nearby", "navigation"], next: { step: action === "find-nearby" ? "choose-place" : "enable-location", label: action === "find-nearby" ? "Choose a place to search around" : "Allow location, or choose a start place" }, message: "We can't see where you are. Allow location in your browser, or choose a place yourself and we'll search around that." } });
  } else if ((action === "start-navigation" || action === "find-nearby") && device && device.hasFix && !device.accurate) {
    add({ base: "info", blocksFor: [], item: { id: "location-rough", field: "device.accuracy", title: "Location is approximate", why: "A rough position can be kilometres off.", affects: ["nearby", "navigation"], next: { step: "none", label: "Move outdoors or turn on GPS" }, message: "Your position is only approximate, so we won't claim exact distances." } });
  }

  // Internal consistency.
  const conflicts = conflictingDays(scheduled);
  if (conflicts.length > 0) {
    add({ base: "important", blocksFor: [], item: { id: "conflicting-times", field: "arrival_time", title: "Stop times don't follow the order", why: "A later stop is timed earlier than the one before it.", affects: ["arrival_times"], next: { step: "review-times", label: "Review the order" }, message: `On Day ${conflicts.join(", Day ")} a stop is timed earlier than the stop before it. Re-run Plan my trip, or reorder the stops.` } });
  }
  const beyond = places.filter((p) => p.day_number !== null && p.day_number > trip.num_days);
  if (beyond.length > 0) {
    add({ base: "important", blocksFor: [], item: { id: "stops-beyond-trip", field: "num_days", title: "Stops on days that don't exist", why: "The trip is shorter than the days these stops are on.", affects: ["route", "arrival_times"], next: { step: "set-dates", label: "Change the trip length" }, message: `${beyond.length} ${beyond.length === 1 ? "stop is" : "stops are"} on days after the trip ends. Make the trip longer or move ${beyond.length === 1 ? "it" : "them"}.` } });
  }

  if ((action === "plan" || action === "check-departure") && effectiveDate && effectiveDate < todayISO) {
    add({ base: "info", blocksFor: [], item: { id: "dates-in-past", field: "start_date", title: "The date is in the past", why: "Forecasts only exist for the future.", affects: ["weather"], next: { step: "set-dates", label: "Change the date" }, message: "That date has already passed, so there is no forecast to check." } });
  }
  if (action === "check-departure") {
    add({ base: "info", blocksFor: [], item: { id: "default-transport", field: "transport", title: "Assuming you travel by car", why: "Driving times and breaks are calculated for a car.", affects: ["arrival_times"], next: { step: "none", label: "" }, message: "Times are for a car with a short break every couple of hours. TrailMate doesn't model other transport yet." } });
  }

  const items: ReadinessItem[] = rules.map((r) => {
    const blocksAction = r.blocksFor.includes(action);
    return { ...r.item, severity: blocksAction ? "blocker" : r.base, blocksAction };
  });
  const rank = { blocker: 0, important: 1, info: 2 } as const;
  items.sort((a, b) => rank[a.severity] - rank[b.severity]);

  const counts = { blocker: 0, important: 0, info: 0 };
  for (const i of items) counts[i.severity]++;
  const unavailable = [...new Set(items.filter((i) => i.severity !== "info").flatMap((i) => i.affects))];
  const canProceed = counts.blocker === 0;
  const headline = !canProceed ? `Needs ${counts.blocker} ${counts.blocker === 1 ? "thing" : "things"} first` : counts.important > 0 ? `Ready, with ${counts.important} ${counts.important === 1 ? "limit" : "limits"}` : "Ready";
  return { action, canProceed, items, counts, unavailable, headline };
}

/** Days where a later stop is timed before an earlier one. */
function conflictingDays(scheduled: ReadinessInput["places"]): number[] {
  const byDay = new Map<number, ReadinessInput["places"]>();
  for (const p of scheduled) byDay.set(p.day_number as number, [...(byDay.get(p.day_number as number) ?? []), p]);
  const bad: number[] = [];
  for (const [day, list] of [...byDay].sort((a, b) => a[0] - b[0])) {
    const ordered = list.filter((p) => p.arrival_time).sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0));
    for (let i = 1; i < ordered.length; i++) if ((ordered[i].arrival_time as string) < (ordered[i - 1].arrival_time as string)) { bad.push(day); break; }
  }
  return bad;
}
