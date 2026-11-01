// The real journey, as a sequence of events, and what it means. Pure: no clock (times and "now" are passed in), no database.
//
// Four things stay apart (see also lib/trip/lifecycle.ts and lib/trip/progress.ts):
//   PLANNED   the schedule: which stop on which day (places.day_number...). Never read or changed here.
//   EVENTS    what really happened and when: the rows of trip_events (migration 20261102000000), append-only.
//   STATE     travelling / paused / resting / awaiting departure: DERIVED here from the events, never stored, so it cannot disagree.
//   DATES     the calendar. A journey is not a calendar day: leaving at 10 PM and arriving at 2 AM is one journey. Midnight changes
//             nothing in the state, and nothing here ever completes anything because the date changed.
//
// What is and is not allowed (the rules the server uses, and the buttons the screen offers):
//   departed     only while awaiting departure.          paused       only while travelling.
//   resumed      only while paused.                      rest_started while travelling or paused.   rest_ended only while resting.
//   Arriving, visiting, skipping, correcting: always recordable, in any state. An arrival with no departure on record is KEPT (GPS may
//   have been off, or the traveller forgot to press "I've left"): refusing it would lose real progress. The timeline says plainly that
//   no departure was recorded; it never invents one.
// Events are ordered by when they happened, not when they were heard: an offline "paused" that arrives after a later "resumed" is
// judged where it belongs in time. An event that does not fit its place is kept in the history but does not change the state
// (`ignored`), and says why.
export const JOURNEY_KINDS = [
  "departed", "paused", "resumed", "rest_started", "rest_ended",
  "approached", "arrived", "passed_through", "exploring_started", "visit_completed", "visit_skipped",
  "visit_corrected", "arrival_corrected", "unplanned_stop_added",
  "revision_proposed", "revision_approved", "revision_rejected", "manual_correction",
] as const;
export type JourneyKind = (typeof JOURNEY_KINDS)[number];
export type EventSource = "gps" | "manual" | "system";
export type MetaValue = string | number | boolean;

export type JourneyEvent = {
  clientEventId: string;
  kind: JourneyKind;
  /** When it happened (ISO). */
  occurredAt: string;
  /** When the server heard (ISO); later than occurredAt for an event made offline. */
  recordedAt?: string | null;
  source: EventSource;
  accuracyM?: number | null;
  placeId?: string | null;
  placeName?: string | null;
  userId?: string | null;
  meta?: Record<string, MetaValue>;
};

// ── Corrections ──
// History is never edited or deleted. A mistake (a tap that was wrong, a time that was off) is put right by a NEW event of kind
// "manual_correction" that points at one of the traveller's OWN earlier events: it can mark it "that didn't happen" (void) or give it the
// time it really had (retime). The original stays in the record and on the timeline, marked as corrected; everything derived from the
// events (the journey's state, who is at a place) uses the corrected picture. Nobody can correct another person's event.
export type Correction = { target: string; action: "void" | "retime"; at?: string };
export const correctionOf = (e: JourneyEvent): Correction | null => {
  if (e.kind !== "manual_correction" || typeof e.meta?.target !== "string") return null;
  const action = e.meta.action;
  if (action === "void") return { target: e.meta.target, action };
  if (action === "retime" && typeof e.meta.at === "string" && Number.isFinite(Date.parse(e.meta.at))) return { target: e.meta.target, action, at: e.meta.at };
  return null;
};

export type Corrected = { events: JourneyEvent[]; voided: Set<string>; retimed: Map<string, { from: string; to: string }> };
/** The events as they stand after corrections: voided ones removed, re-timed ones moved, the corrections themselves taken out. */
export function applyCorrections(events: JourneyEvent[]): Corrected {
  const byId = new Map(events.map((e) => [e.clientEventId, e]));
  const voided = new Set<string>();
  const retimed = new Map<string, { from: string; to: string }>();
  const latest = new Map<string, Correction>();
  for (const e of [...events].filter((x) => correctionOf(x)).sort((a, b) => (Date.parse(a.recordedAt ?? a.occurredAt) || 0) - (Date.parse(b.recordedAt ?? b.occurredAt) || 0) || a.clientEventId.localeCompare(b.clientEventId))) {
    const c = correctionOf(e)!;
    const target = byId.get(c.target);
    if (!target || correctionOf(target) || (target.userId ?? null) !== (e.userId ?? null)) continue; // only a person's own, real events can be corrected
    latest.set(c.target, c); // the last word wins
  }
  for (const [id, c] of latest) {
    if (c.action === "void") voided.add(id);
    else if (c.at) retimed.set(id, { from: byId.get(id)!.occurredAt, to: c.at });
  }
  const out = events.filter((e) => !correctionOf(e) && !voided.has(e.clientEventId)).map((e) => (retimed.has(e.clientEventId) ? { ...e, occurredAt: retimed.get(e.clientEventId)!.to } : e));
  return { events: out, voided, retimed };
}

/** The time of day `hhmm` on the same local date as `originalIso`, as an ISO time; null for an unusable time. */
export function retimeTo(originalIso: string, hhmm: string, offsetMin: number): string | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  const base = Date.parse(originalIso);
  if (!m || !Number.isFinite(base)) return null;
  const localMidnight = Math.floor((base + offsetMin * 60_000) / 86_400_000) * 86_400_000 - offsetMin * 60_000;
  return new Date(localMidnight + (Number(m[1]) * 60 + Number(m[2])) * 60_000).toISOString();
}

const MAX_RETIME_AGE_MS = 8 * 24 * 3_600_000;
const FUTURE_SKEW_MS = 5 * 60_000;
/**
 * Why a correction cannot be made, or null. `own` = the person's own events. A correction must point at one of them that is not itself a
 * correction and not already voided; a new time must be real (not in the future, not older than the outbox keeps); and it must not leave the
 * journey out of order: if voiding or moving an event would make a LATER event not fit (voiding "left" while a "paused" depends on it),
 * it is refused and says which to correct first.
 */
export function correctionError(own: JourneyEvent[], c: Correction, nowMs: number): string | null {
  const target = own.find((e) => e.clientEventId === c.target);
  if (!target || correctionOf(target)) return "That event wasn't found among your own, so it can't be corrected.";
  const now = applyCorrections(own);
  if (now.voided.has(c.target)) return "That event was already marked as a mistake.";
  if (c.action === "retime") {
    const t = c.at ? Date.parse(c.at) : NaN;
    if (!Number.isFinite(t)) return "That time isn't valid.";
    if (t > nowMs + FUTURE_SKEW_MS) return "That time is in the future.";
    if (nowMs - t > MAX_RETIME_AGE_MS) return "That is too long ago to change safely.";
    if (t === Date.parse(now.events.find((e) => e.clientEventId === c.target)?.occurredAt ?? "")) return "That is the time it already has.";
  }
  const hypothetical: JourneyEvent = { clientEventId: "hypothetical-correction", kind: "manual_correction", occurredAt: new Date(nowMs).toISOString(), recordedAt: new Date(nowMs + 1).toISOString(), source: "manual", userId: target.userId ?? null, meta: { target: c.target, action: c.action, ...(c.at ? { at: c.at } : {}) } };
  const before = deriveJourney(own).ignored.length, after = deriveJourney([...own, hypothetical]).ignored.length;
  if (after > before) return c.action === "void" ? "Other events depend on this one. Correct those first." : "That time would put it out of order with your other events.";
  return null;
}

export type JourneyState = "awaiting-departure" | "travelling" | "paused" | "resting";
export const TRAVEL_KINDS: ReadonlySet<JourneyKind> = new Set(["departed", "paused", "resumed", "rest_started", "rest_ended"]);

const NEXT: Partial<Record<JourneyKind, { from: JourneyState[]; to: JourneyState }>> = {
  departed: { from: ["awaiting-departure"], to: "travelling" },
  paused: { from: ["travelling"], to: "paused" },
  resumed: { from: ["paused"], to: "travelling" },
  rest_started: { from: ["travelling", "paused"], to: "resting" },
  rest_ended: { from: ["resting"], to: "travelling" },
};

const STATE_WORDS: Record<JourneyState, string> = { "awaiting-departure": "not started yet", travelling: "on the road", paused: "paused", resting: "resting" };

/** Why `kind` cannot happen in `state`, in plain words; null when it can (every non-travel event always can). */
export function transitionError(state: JourneyState, kind: JourneyKind): string | null {
  const rule = NEXT[kind];
  if (!rule || rule.from.includes(state)) return null;
  return `The journey is ${STATE_WORDS[state]}, so "${kind.replace("_", " ")}" doesn't fit here.`;
}

const t = (iso: string) => Date.parse(iso);
const byTime = (a: JourneyEvent, b: JourneyEvent) =>
  t(a.occurredAt) - t(b.occurredAt) || t(a.recordedAt ?? a.occurredAt) - t(b.recordedAt ?? b.occurredAt) || a.clientEventId.localeCompare(b.clientEventId);
/** Events with a usable time, oldest first. A damaged time is dropped rather than guessed. */
export const ordered = (events: JourneyEvent[]): JourneyEvent[] => events.filter((e) => Number.isFinite(t(e.occurredAt))).sort(byTime);

export type Journey = {
  state: JourneyState;
  /** When the current state began (ISO), null before departure. */
  since: string | null;
  /** The real departure (ISO), null when none was recorded. */
  departedAt: string | null;
  /** The stop the traveller said they reached and has not finished or corrected. */
  atPlace: { placeId: string | null; name: string | null; arrivedAt: string } | null;
  /** Events kept in the history that did not change the state, with the reason. */
  ignored: { event: JourneyEvent; reason: string }[];
};

/** What the events say the journey is doing. `closed`: the trip was finished or cancelled: nothing further is "travelling". */
export function deriveJourney(raw: JourneyEvent[]): Journey {
  const events = applyCorrections(raw).events;
  let state: JourneyState = "awaiting-departure";
  let since: string | null = null;
  let departedAt: string | null = null;
  let atPlace: Journey["atPlace"] = null;
  const ignored: Journey["ignored"] = [];
  const seen = new Set<string>();
  for (const e of ordered(events)) {
    if (seen.has(e.clientEventId)) continue; // the same event twice (a retry that was heard twice) counts once
    seen.add(e.clientEventId);
    if (TRAVEL_KINDS.has(e.kind)) {
      const why = transitionError(state, e.kind);
      if (why) { ignored.push({ event: e, reason: why }); continue; }
      state = NEXT[e.kind]!.to;
      since = e.occurredAt;
      if (e.kind === "departed") departedAt = e.occurredAt;
      if (e.kind === "rest_ended" || e.kind === "resumed") atPlace = null;
      continue;
    }
    if (e.kind === "arrived") atPlace = { placeId: e.placeId ?? null, name: e.placeName ?? null, arrivedAt: e.occurredAt };
    else if ((e.kind === "arrival_corrected" || e.kind === "visit_completed" || e.kind === "visit_skipped") && atPlace && (atPlace.placeId === (e.placeId ?? null))) atPlace = null;
  }
  return { state, since, departedAt, atPlace, ignored };
}

/** The journey as it stood at a moment: how the server judges an event that arrives late (made offline hours ago). */
export const journeyAsOf = (events: JourneyEvent[], atISO: string): Journey => deriveJourney(applyCorrections(events).events.filter((e) => t(e.occurredAt) <= t(atISO))); // corrections first: one made later still counts for an earlier moment

/** What a new event would do: the reason it does not fit, or null. */
export function eventError(events: JourneyEvent[], next: Pick<JourneyEvent, "kind" | "occurredAt">): string | null {
  if (!TRAVEL_KINDS.has(next.kind)) return null;
  return transitionError(journeyAsOf(events, next.occurredAt).state, next.kind);
}

/** The buttons the screen offers for a state. A closed trip offers none. */
export function allowedActions(state: JourneyState, closed = false): JourneyKind[] {
  if (closed) return [];
  switch (state) {
    case "awaiting-departure": return ["departed"];
    case "travelling": return ["paused", "rest_started"];
    case "paused": return ["resumed", "rest_started"];
    case "resting": return ["rest_ended"];
  }
}

// ── The timeline ──
export type Certainty = "gps" | "manual" | "system" | "inferred" | "pending";
export type TimelineRow = {
  key: string;
  at: string;
  label: string;
  detail: string | null;
  certainty: Certainty;
  /** Whose event, when it is not the viewer's. */
  member: string | null;
  /** A note the reader should see: "no departure was recorded", or why an event did not change the journey. */
  note: string | null;
  /** The viewer's own event (and so one they may correct), what kind it is, and whether it was corrected. */
  own: boolean; kind: JourneyKind | null; corrected: "voided" | "retimed" | null; originalAt: string | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
const local = (ms: number, offsetMin: number) => new Date(ms + offsetMin * 60_000);
export function timeText(iso: string | number, offsetMin: number): string {
  const d = local(typeof iso === "number" ? iso : t(iso), offsetMin);
  const h = d.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(d.getUTCMinutes())} ${h < 12 ? "AM" : "PM"}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function dateText(ms: number, offsetMin: number): string {
  const d = local(ms, offsetMin);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** Local midnights strictly after `fromMs` and before `toMs`. */
function midnightsBetween(fromMs: number, toMs: number, offsetMin: number, cap = 14): number[] {
  const out: number[] = [];
  const first = Math.floor((fromMs + offsetMin * 60_000) / 86_400_000 + 1) * 86_400_000 - offsetMin * 60_000;
  for (let m = first; m < toMs && out.length < cap; m += 86_400_000) out.push(m);
  return out;
}

const name = (e: JourneyEvent) => e.placeName?.trim() || "a stop";
function words(e: JourneyEvent): { label: string; detail: string | null } {
  const from = typeof e.meta?.from === "string" && e.meta.from ? e.meta.from : null;
  switch (e.kind) {
    case "departed": return { label: from ? `Departed from ${from}` : "Departed", detail: null };
    case "paused": return { label: "Paused", detail: typeof e.meta?.note === "string" ? e.meta.note : null };
    case "resumed": return { label: "Back on the road", detail: null };
    case "rest_started": return { label: "Rest started", detail: null };
    case "rest_ended": return { label: "Rest ended", detail: null };
    case "approached": return { label: `Approaching ${name(e)}`, detail: null };
    case "arrived": return { label: `Arrived at ${name(e)}`, detail: null };
    case "passed_through": return { label: `Passed through ${name(e)}`, detail: null };
    case "exploring_started": return { label: `Exploring ${name(e)}`, detail: null };
    case "visit_completed": return { label: `Visit completed: ${name(e)}`, detail: null };
    case "visit_skipped": return { label: `Skipped ${name(e)}`, detail: null };
    case "visit_corrected": return { label: `Corrected: ${name(e)} is back to planned`, detail: null };
    case "arrival_corrected": return { label: `Corrected: not at ${name(e)} yet`, detail: null };
    case "unplanned_stop_added": return { label: `Unplanned stop: ${name(e)}`, detail: null };
    case "revision_proposed": return { label: "Itinerary change proposed", detail: typeof e.meta?.note === "string" ? e.meta.note : null };
    case "revision_approved": return { label: "Itinerary change approved", detail: typeof e.meta?.note === "string" ? e.meta.note : null };
    case "revision_rejected": return { label: "Itinerary change declined", detail: typeof e.meta?.note === "string" ? e.meta.note : null };
    case "manual_correction": return { label: "Progress corrected by hand", detail: typeof e.meta?.note === "string" ? e.meta.note : null };
  }
}

export type TimelineOptions = {
  offsetMin: number;
  /** The viewer: their events carry no name, others' carry theirs. */
  me?: string | null;
  names?: Record<string, string>;
  /** Events made on this phone and not yet sent: shown as "waiting to send", never as recorded. */
  pending?: JourneyEvent[];
  /** The current time (ms): lets a journey still under way show the midnights it has crossed. */
  nowMs?: number;
};

/**
 * One line per event, oldest first. Lines that are not events say so: "Journey continued into Tue 3 Nov" is INFERRED from a journey
 * that was on the road at midnight (certainty "inferred"), never presented as something the phone recorded.
 */
export function buildTimeline(events: JourneyEvent[], o: TimelineOptions): TimelineRow[] {
  const mine = (e: JourneyEvent) => !o.me || !e.userId || e.userId === o.me;
  const pendingIds = new Set((o.pending ?? []).map((e) => e.clientEventId));
  const raw = [...events.filter((e) => !pendingIds.has(e.clientEventId)), ...(o.pending ?? [])];
  // Corrections applied: what counts is the corrected picture; what was corrected stays visible, marked.
  const fx = applyCorrections(raw);
  const all = ordered([...fx.events, ...raw.filter((e) => fx.voided.has(e.clientEventId))]);
  const journey = deriveJourney(events.filter(mine));
  const ignored = new Map(journey.ignored.map((x) => [x.event.clientEventId, x.reason]));
  const hasDeparture = journey.departedAt !== null;

  const rows: TimelineRow[] = [];
  const myTravel = all.filter((e) => mine(e) && TRAVEL_KINDS.has(e.kind) && !ignored.has(e.clientEventId) && !fx.voided.has(e.clientEventId));
  // The journey on the road at midnight: from each travel event that leaves it travelling until the next travel event (or now).
  let state: JourneyState = "awaiting-departure";
  myTravel.forEach((e, i) => {
    state = NEXT[e.kind]!.to;
    if (state !== "travelling") return;
    const end = i + 1 < myTravel.length ? t(myTravel[i + 1].occurredAt) : o.nowMs ?? t(e.occurredAt);
    for (const m of midnightsBetween(t(e.occurredAt), end, o.offsetMin)) {
      rows.push({ key: `midnight:${m}`, at: new Date(m).toISOString(), label: `Journey continued into ${dateText(m, o.offsetMin)}`, detail: null, certainty: "inferred", member: null, note: "Worked out from the journey being on the road at midnight; nothing was recorded.", own: false, kind: null, corrected: null, originalAt: null });
    }
  });

  let arrivedBeforeDeparture = false;
  for (const e of all) {
    const w = words(e);
    const own = mine(e);
    let note = ignored.get(e.clientEventId) ?? null;
    const voided = fx.voided.has(e.clientEventId);
    const re = fx.retimed.get(e.clientEventId);
    if (voided) note = "You marked this as a mistake, so it doesn't count.";
    else if (re) note = `${note ? `${note} ` : ""}You corrected the time (it was ${timeText(re.from, o.offsetMin)}).`;
    if (!voided && e.kind === "arrived" && own && (!hasDeparture || t(e.occurredAt) < t(journey.departedAt!)) && !arrivedBeforeDeparture) {
      arrivedBeforeDeparture = true;
      note = "No departure was recorded before this.";
    }
    rows.push({
      key: e.clientEventId, at: e.occurredAt, label: w.label, detail: w.detail,
      certainty: pendingIds.has(e.clientEventId) ? "pending" : e.source,
      member: own ? null : (e.userId && o.names?.[e.userId]) || "Someone on the trip", note,
      own, kind: e.kind, corrected: voided ? "voided" : re ? "retimed" : null, originalAt: re?.from ?? null,
    });
  }
  return rows.sort((a, b) => t(a.at) - t(b.at) || (a.certainty === "inferred" ? -1 : 0));
}

/**
 * Who is at a place right now, by their own word: each person's latest "arrived" / "not here yet" about it. A place can have several
 * people arrived at once, each at their own time, and one person correcting themselves never removes another person's arrival.
 */
export function activeArrivalUsers(raw: JourneyEvent[], placeId: string): Set<string> {
  const latest = new Map<string, JourneyEvent>();
  for (const e of ordered(applyCorrections(raw).events)) if (e.placeId === placeId && e.userId && (e.kind === "arrived" || e.kind === "arrival_corrected")) latest.set(e.userId, e);
  return new Set([...latest].filter(([, e]) => e.kind === "arrived").map(([u]) => u));
}

/** Which event a stop-progress change is, for the timeline (the server logs one each time progress is saved). */
export function kindForProgress(change: { status?: "planned" | "done" | "skipped"; was?: "planned" | "done" | "skipped" | null; arrived?: boolean }): JourneyKind {
  if (change.arrived !== undefined) return change.arrived ? "arrived" : "arrival_corrected";
  if (change.status === "done") return "visit_completed";
  if (change.status === "skipped") return "visit_skipped";
  return "visit_corrected";
}
