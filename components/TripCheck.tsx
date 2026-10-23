"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { useLocalJson } from "@/lib/client/use-local-json";
import { useNowMinute } from "@/lib/client/use-now";
import { dateOfTripDay, isRealISODate } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { isoDate } from "@/lib/time-context";
import { INDIA_UTC_OFFSET_MIN, clock12, clockOf, dateOf, durationLabel, localToUtcMs, localizeClocks, time12 } from "@/lib/travel/clock";
import { recommendDeparture, type DriveBasis, type WeatherNote } from "@/lib/travel/departure";
import { eventsFromReadiness, eventsFromVerdicts, type TravelEvent } from "@/lib/travel/events";
import { checkDeparture, type FeasStop, type Option, type StopVerdict } from "@/lib/travel/feasibility";
import { normalizeHoursInput } from "@/lib/travel/hours-input";
import { evaluatorFromIntervals, type OpenInterval } from "@/lib/travel/hours-intervals";
import type { LookupOutcome } from "@/lib/travel/hours-match";
import { DEFAULT_PREFS, decide, type Decision, type EventState } from "@/lib/travel/notify-policy";
import { checkReadiness, type NextStep, type ReadinessItem } from "@/lib/travel/readiness";
import type { Place, Trip } from "@/lib/types";
import { useTerrain } from "@/lib/client/use-terrain";
import { buildTimeline, kmAlongLine, type TimelineItem } from "@/lib/travel/timeline";
import { hillStationLinks, implications, linkSentence, NOT_ASSESSED, routeCharacter } from "@/lib/travel/hills";
import { useWeatherBoard } from "@/lib/client/use-weather-board";
import { weatherStore } from "@/lib/client/weather-store";
import { forecastHorizonMs } from "@/lib/forecast/areas";
import type { BoardStop } from "@/lib/forecast/board";
import { momentAt } from "@/lib/forecast/moment";
import { arrivalNote } from "@/lib/forecast/present";
import { DEFAULT_VIEW } from "@/lib/forecast/view-time";

type Stored = {
  date: string;
  time: string;
  day: number | null;
  ran: boolean;
  /**
   * LEGACY: hours typed before they were saved on the trip (they lived only in this browser). The check no longer uses them; the
   * traveller is offered to save them to the trip, after which they are removed from here.
   */
  hours: Record<string, { hours: string; typed: string; at: number }>;
  states: Record<string, EventState>;
  seen: Record<string, { title: string }>;
};
const EMPTY: Stored = { date: "", time: "", day: null, ran: false, hours: {}, states: {}, seen: {} };

type HoursFields = Pick<Place, "opening_hours" | "hours_source" | "hours_ref" | "hours_fetched_at" | "hours_confirmed_at">;
type WindowStop = { status: "ok"; intervals: OpenInterval[] } | { status: "unverifiable"; reason: string };
type HoursWindow = { key: string; status: "ok" | "error"; fromMs?: number; toMs?: number; stops?: Record<string, WindowStop> };
const fieldsOf = (p: Place): HoursFields => ({ opening_hours: p.opening_hours ?? null, hours_source: p.hours_source ?? null, hours_ref: p.hours_ref ?? null, hours_fetched_at: p.hours_fetched_at ?? null, hours_confirmed_at: p.hours_confirmed_at ?? null });
const confirmedOf = (h: HoursFields) => h.hours_source === "traveller" || !!h.hours_confirmed_at;
const shortDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "");
function sourceLine(h: HoursFields): string {
  if (h.hours_source === "traveller") return `Entered by a trip member${h.hours_confirmed_at ? ` on ${shortDate(h.hours_confirmed_at)}` : ""}.`;
  if (h.hours_source === "map_data") return h.hours_confirmed_at
    ? `From map data (OpenStreetMap), confirmed by a trip member on ${shortDate(h.hours_confirmed_at)}.`
    : `From map data (OpenStreetMap)${h.hours_fetched_at ? `, read ${shortDate(h.hours_fetched_at)}` : ""}. Not confirmed yet: check them against an official source or a sign, then confirm or correct them.`;
  return "";
}

type Advisor = { asked: number; busy: boolean; error: string | null; legs: { day: number; minutes: Record<string, number>; basis: DriveBasis } | null };
/** The three honest answers to "will it be open?", in the traveller's words. Never "open" unless we have hours that say so. */
const ANSWER: Record<string, { label: string; tone: "ok" | "warn" | "risk" | "info" }> = {
  open: { label: "Likely open", tone: "ok" }, closes_soon: { label: "Likely open, but closing soon", tone: "warn" }, closed_on_arrival: { label: "Likely closed", tone: "risk" },
  opens_later: { label: "Likely closed: opens later", tone: "warn" }, may_close: { label: "Could be closed (it depends on the drive)", tone: "warn" }, may_be_early: { label: "May open just after you arrive", tone: "info" },
  hours_unverified: { label: "Unable to verify", tone: "info" }, needs_drive_time: { label: "Needs a driving time", tone: "info" },
};
const OPTION_LABEL: Record<Option, string> = {
  adjust_departure: "Change when you leave", reorder: "Reorder stops (use Plan my trip)", shorten_stop: "Spend less time there", skip_stop: "Skip it",
  add_overnight: "Stop overnight on the way", visit_another_day: "Visit on another day", enter_hours: "Add the hours you know",
  check_before_going: "Check before you go", continue: "Continue anyway",
};
const tone = {
  ok: { box: "border-teal/30 bg-teal-light/40", icon: "checkCircle" as const, text: "text-teal-ink" },
  info: { box: "border-line bg-sky/50", icon: "info" as const, text: "text-ink-muted" },
  warn: { box: "border-marigold/50 bg-marigold-light/50", icon: "warn" as const, text: "text-[#7a4a00]" },
  risk: { box: "border-clay/40 bg-clay-light/50", icon: "warn" as const, text: "text-clay-ink" },
};
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

/**
 * Trip check: (1) what is missing and what it limits, (2) "if I leave at this time, will each stop be open when I arrive?",
 * (3) the alerts that follow, handled by the notification rules (dismiss, snooze, no repeats, nothing alarming from unverified data).
 * It only DESCRIBES and SUGGESTS: it never changes the itinerary. Choices are kept on this device.
 */
export function TripCheck({ tripId, trip, places, activeDay, today, roadLine = null, onClose, onSetDates, onPlanTrip }: { tripId: string; trip: Trip; places: Place[]; activeDay: number; today: string; /** The real road for the day shown on the plan, when it has loaded. */ roadLine?: [number, number][] | null; onClose?: () => void; /** Open the dates panel. */ onSetDates?: () => void; /** Open Plan my trip. */ onPlanTrip?: () => void }) {
  const [s, set] = useLocalJson<Stored>(`tm:trip-check:${tripId}`, EMPTY);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [hoursError, setHoursError] = useState<Record<string, string>>({});
  const [terrainOn, setTerrainOn] = useState(false);
  const nowMs = useNowMinute() * 60_000; // 0 until the browser clock is ready
  // Hours saved during this visit (the page's place list is only re-read on the next load).
  const [hoursOverride, setHoursOverride] = useState<Record<string, HoursFields>>({});
  const [hoursWarn, setHoursWarn] = useState<Record<string, string[]>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [hoursVersion, setHoursVersion] = useState(0);
  const [lookup, setLookup] = useState<{ busy: boolean; summary?: string; error?: string }>({ busy: false });
  const [win, setWin] = useState<HoursWindow | null>(null);
  const [advisor, setAdvisor] = useState<Advisor>({ asked: 0, busy: false, error: null, legs: null });
  const resultRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef("");
  const hoursOf = (p: Place): HoursFields => hoursOverride[p.id] ?? fieldsOf(p);

  const dayNo = s.day ?? activeDay;
  const dayStops = useMemo(() => places.filter((p) => p.day_number === dayNo).sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0)), [places, dayNo]);
  // Driving times: the plan's saved ones when it has them, otherwise the ones we fetched just now for this day. Never invented.
  const legsForDay = advisor.legs && advisor.legs.day === dayNo ? advisor.legs : null;
  const driveOf = (p: Place): number | null => p.drive_minutes ?? legsForDay?.minutes[p.id] ?? null;
  const tripDay = dateOfTripDay(trip.start_date, dayNo);
  const date = s.date || (tripDay ? isoDate(tripDay) : "");
  const forReadiness = (p: Place) => ({ id: p.id, name: p.name, day_number: p.day_number, sequence_order: p.sequence_order, arrival_time: p.arrival_time, drive_minutes: driveOf(p), hours: hoursOf(p).opening_hours ?? null });

  const general = useMemo(() => checkReadiness({ action: "plan", todayISO: today, trip, places: places.map(forReadiness) }), [today, trip, places, hoursOverride, legsForDay]); // eslint-disable-line react-hooks/exhaustive-deps -- forReadiness only reads hoursOverride, the fetched legs and p
  const readiness = useMemo(
    () => checkReadiness({ action: "check-departure", todayISO: today, trip, places: dayStops.map(forReadiness), departure: { date: date || null, time: s.time || null } }),
    [today, trip, dayStops, date, s.time, hoursOverride, legsForDay] // eslint-disable-line react-hooks/exhaustive-deps -- as above
  );

  const typedMs = date && s.time ? localToUtcMs(date, s.time, INDIA_UTC_OFFSET_MIN) : null;
  const useTyped = s.ran && typedMs !== null; // the traveller asked about a specific time; otherwise we show our recommendation

  // The server reads the hours (full opening_hours syntax) and sends the open intervals around the departure date.
  const needWindow = isRealISODate(date) && dayStops.some((p) => !!hoursOf(p).opening_hours);
  const windowKey = needWindow ? `${date}|${hoursVersion}` : null;
  useEffect(() => {
    if (!windowKey) return;
    const ctrl = new AbortController();
    fetch(`/api/trips/${tripId}/hours?date=${windowKey.split("|")[0]}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { fromMs: number; toMs: number; stops: Record<string, WindowStop> }) => setWin({ key: windowKey, status: "ok", fromMs: d.fromMs, toMs: d.toMs, stops: d.stops }))
      .catch(() => { if (!ctrl.signal.aborted) setWin({ key: windowKey, status: "error" }); });
    return () => ctrl.abort();
  }, [tripId, windowKey]);
  const w = windowKey && win?.key === windowKey ? win : null;
  const hoursLoading = !!windowKey && !w;

  const stops: FeasStop[] = useMemo(() => dayStops.map((p) => {
    const h = hoursOverride[p.id] ?? fieldsOf(p);
    const entry = w?.status === "ok" ? w.stops?.[p.id] : undefined;
    const evaluate = !h.opening_hours ? undefined
      : entry?.status === "ok" && w?.fromMs !== undefined && w.toMs !== undefined ? evaluatorFromIntervals({ fromMs: w.fromMs, toMs: w.toMs, intervals: entry.intervals }, INDIA_UTC_OFFSET_MIN)
      : () => ({ state: "unknown" as const });
    const hoursNote = !h.opening_hours ? null
      : entry?.status === "unverifiable" ? entry.reason
      : w?.status === "error" ? "We couldn't load the opening hours just now."
      : null;
    return {
      id: p.id, name: p.name, driveMin: driveOf(p), visitMin: p.visit_minutes ?? Math.round(CATEGORIES[normalizeCategory(p.category)].hours * 60),
      hours: h.opening_hours ?? null, hoursSource: h.hours_source === "traveller" ? ("user" as const) : h.hours_source === "map_data" ? ("osm" as const) : null,
      hoursConfirmed: confirmedOf(h), evaluate, hoursNote,
    };
  }), [dayStops, hoursOverride, w, legsForDay]); // eslint-disable-line react-hooks/exhaustive-deps -- driveOf reads legsForDay
  // The weather at each stop for the moment you would ARRIVE (the hourly forecast, lib/forecast; fetched for the checked day and kept
  // fresh by itself). A start time is judged on the weather at its own arrival times, never on the day's maximum.
  const wxStops = useMemo<BoardStop[]>(() => (isRealISODate(date) ? dayStops.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, isNext: false, liveEta: null, planned: null, dayISO: date, typical: null })) : []), [dayStops, date]);
  const wx = useWeatherBoard({ enabled: nowMs > 0 && wxStops.length > 0, nowMs, mode: DEFAULT_VIEW, here: null, stops: wxStops, road: [] });
  const forecastAt = useCallback(
    (p: { lat: number; lng: number }, t: number) => arrivalNote(momentAt(weatherStore.area(p, t - 2 * 3_600_000, t + 2 * 3_600_000), p, t, nowMs, weatherStore.horizonEnd() ?? forecastHorizonMs(nowMs))),
    [nowMs, wx], // eslint-disable-line react-hooks/exhaustive-deps -- `wx` changes when new forecasts arrive in the store
  );
  const weatherNotes: WeatherNote[] = useMemo(() => dayStops.map((p) => ({ stopId: p.id, at: (t: number) => { const n = forecastAt(p, t); return n ? { kind: n.kind, label: n.label } : null; } })), [dayStops, forecastAt]);
  const allDrivesKnown = stops.length > 0 && stops.every((x) => x.driveMin !== null);
  const advice = useMemo(
    () => (advisor.asked > 0 && isRealISODate(date) && !hoursLoading && allDrivesKnown ? recommendDeparture({ dateISO: date, stops, driveBasis: dayStops.every((p) => p.drive_minutes != null) ? "plan" : legsForDay?.basis ?? "plan", weather: weatherNotes }) : null),
    [advisor.asked, date, hoursLoading, allDrivesKnown, stops, dayStops, legsForDay, weatherNotes]
  );
  const departureMs = useTyped ? typedMs : advice?.departureMs ?? null;
  const result = useMemo(() => (useTyped ? (readiness.canProceed && !hoursLoading ? checkDeparture({ departureMs: typedMs as number, stops }) : null) : advice?.result ?? null), [useTyped, readiness.canProceed, typedMs, stops, hoursLoading, advice]);


  // Terrain is fetched only when asked, and only for the day whose road is on the plan.
  const canTerrain = dayNo === activeDay && !!roadLine && roadLine.length >= 2;
  const terrain = useTerrain(canTerrain ? roadLine : null, terrainOn && canTerrain);
  const timeline = useMemo(
    () => (result && departureMs !== null
      ? buildTimeline({
          departureMs, utcOffsetMin: INDIA_UTC_OFFSET_MIN,
          stops: dayStops.map((p, i) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, visitMin: stops[i]?.visitMin ?? 60 })),
          verdicts: result.verdicts, line: canTerrain ? roadLine : null, terrain: terrain.result?.segments ?? null,
          weather: Object.fromEntries(dayStops.map((p) => [p.id, (t: number) => { const n = forecastAt(p, t); return n ? { title: n.title, detail: n.detail, tone: n.tone } : null; }])),
        })
      : []),
    [result, departureMs, dayStops, stops, canTerrain, roadLine, terrain.result, forecastAt]
  );

  // Events and what the policy says about each (only once the browser clock is known, so server and browser agree on first paint).
  const events: { e: TravelEvent; d: Decision }[] = useMemo(() => {
    if (!(s.ran || advisor.asked > 0) || !nowMs) return [];
    // "Missing information" prompts (no dates, no departure time…) are already shown in the list at the top. They are form prompts, not
    // alerts, so they are kept out of Alerts and the history.
    const found = [...(result ? eventsFromVerdicts(tripId, result.verdicts, nowMs) : []), ...eventsFromReadiness(tripId, readiness.items, nowMs)].filter((e) => e.type !== "missing_information");
    return found.map((e) => ({ e, d: decide(e, s.states[e.id] ?? {}, DEFAULT_PREFS, nowMs, INDIA_UTC_OFFSET_MIN) }));
  }, [s.ran, advisor.asked, nowMs, result, readiness.items, s.states, tripId]);
  const shown = events.filter(({ e, d }) => e.severity !== "info" && d.deliver !== "none" && d.suppressedBecause !== "Dismissed" && d.suppressedBecause !== "Snoozed");
  const parked = events.filter(({ e, d }) => e.severity !== "info" && (d.suppressedBecause === "Dismissed" || d.suppressedBecause === "Snoozed"));
  const currentIds = new Set(events.map(({ e }) => e.id));
  const resolved = Object.entries(s.seen).filter(([id]) => !currentIds.has(id) && !id.startsWith("missing_information:"));

  /** Where this day's driving starts: the trip's start on day 1, otherwise where the last earlier day ended (falling back to the trip start). */
  function dayOrigin(): { lat: number; lng: number } | null {
    const earlier = places.filter((p) => p.day_number !== null && (p.day_number as number) < dayNo);
    if (earlier.length > 0) {
      const lastDay = Math.max(...earlier.map((p) => p.day_number as number));
      const last = earlier.filter((p) => p.day_number === lastDay).sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0)).at(-1);
      if (last) return { lat: last.lat, lng: last.lng };
    }
    return trip.start_lat != null && trip.start_lng != null ? { lat: trip.start_lat, lng: trip.start_lng } : null;
  }
  /**
   * The plan only has driving times after "Plan my trip" has been applied. Instead of sending the traveller away, fetch the road times for
   * this day now (one routing request, nothing saved). If routing is down the answer is a straight-line estimate and is labelled as one.
   */
  async function ensureLegs(): Promise<void> {
    if (dayStops.length === 0 || dayStops.every((p) => driveOf(p) !== null)) return;
    const from = dayOrigin();
    if (!from) { setAdvisor((a) => ({ ...a, busy: false, error: "This trip has no start point, so we can't measure driving times. Plan my trip needs one too." })); return; }
    if (dayStops.length > 11) { setAdvisor((a) => ({ ...a, busy: false, error: "This day has more than 11 stops, which is more than we can route at once. Move some to another day." })); return; }
    setAdvisor((a) => ({ ...a, busy: true, error: null }));
    try {
      const res = await fetch("/api/eta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: [from, ...dayStops.map((p) => ({ lat: p.lat, lng: p.lng }))] }) });
      const j = (await res.json().catch(() => null)) as { legs?: { minutes: number }[]; source?: string; error?: string } | null;
      if (!res.ok || !Array.isArray(j?.legs) || j.legs.length !== dayStops.length) { setAdvisor((a) => ({ ...a, busy: false, error: j?.error ?? "We couldn't get driving times just now. Try again in a moment." })); return; }
      const minutes = Object.fromEntries(dayStops.map((p, i) => [p.id, (j.legs as { minutes: number }[])[i].minutes]));
      setAdvisor((a) => ({ ...a, busy: false, error: null, legs: { day: dayNo, minutes, basis: j.source === "osrm" ? "road" : "estimate" } }));
    } catch {
      setAdvisor((a) => ({ ...a, busy: false, error: "Network problem: check your connection and try again." }));
    }
  }
  /** Check a time the traveller typed. Fetches missing driving times first instead of dead-ending. */
  function run() { set((c) => ({ ...c, ran: true, seen: { ...c.seen, ...Object.fromEntries(events.map(({ e }) => [e.id, { title: e.title }])) } })); void ensureLegs(); }
  /** Work out the best time to leave. */
  function findBest() { set((c) => ({ ...c, ran: false })); setAdvisor((a) => ({ ...a, asked: a.asked + 1, error: null })); void ensureLegs(); }
  // A time that was checked earlier (kept on this device) but whose driving times are missing: fetch them now rather than show a dead end.
  const needsLegs = s.ran && dayStops.length > 0 && dayStops.some((p) => driveOf(p) === null);
  useEffect(() => { if (needsLegs && !advisor.busy && !advisor.error && !legsForDay) void ensureLegs(); }, [needsLegs, advisor.busy, advisor.error, legsForDay, dayNo]); // eslint-disable-line react-hooks/exhaustive-deps -- ensureLegs reads the same state
  // Bring the answer into view and move focus to it, so pressing the button is never silent.
  const outcomeKey = `${advisor.asked}|${s.ran ? 1 : 0}|${advice ? advice.status : ""}|${result ? "r" : ""}|${advisor.error ? "e" : ""}|${!readiness.canProceed && s.ran ? "b" : ""}`;
  useEffect(() => {
    if (advisor.asked === 0 && !s.ran) return;
    if (!advice && !result && !advisor.error && !(s.ran && !readiness.canProceed)) return;
    if (scrolledFor.current === outcomeKey) return;
    scrolledFor.current = outcomeKey;
    resultRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    resultRef.current?.focus?.({ preventScroll: true });
  }, [outcomeKey]); // eslint-disable-line react-hooks/exhaustive-deps -- fires once per distinct outcome
  function shift(verdict: StopVerdict) {
    if (departureMs === null || !verdict.fix?.minutes) return;
    const dir = verdict.fix.kind === "leave_earlier" ? -1 : 1;
    const next = departureMs + dir * verdict.fix.minutes * 60_000;
    set((c) => ({ ...c, date: dateOf(next, INDIA_UTC_OFFSET_MIN), time: clockOf(next, INDIA_UTC_OFFSET_MIN), ran: true }));
  }
  function nextDay() { if (!date) return; const n = (departureMs ?? localToUtcMs(date, "12:00", INDIA_UTC_OFFSET_MIN)!) + 24 * 3_600_000; set((c) => ({ ...c, date: dateOf(n, INDIA_UTC_OFFSET_MIN), ran: true })); }
  /** Save, clear or confirm a stop's hours ON THE TRIP. The server validates the text with the real opening_hours parser. */
  async function patchHours(placeId: string, body: { value: string | null } | { confirm: true }): Promise<boolean> {
    setSavingId(placeId);
    try {
      const res = await fetch(`/api/places/${placeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hours: body }) });
      const j = (await res.json().catch(() => null)) as (HoursFields & { error?: string; warnings?: string[] }) | null;
      if (!res.ok || !j) { setHoursError((e) => ({ ...e, [placeId]: j?.error ?? "Couldn't save the hours. Check your connection and try again." })); return false; }
      setHoursError((e) => { const { [placeId]: _drop, ...rest } = e; void _drop; return rest; });
      setHoursWarn((wm) => ({ ...wm, [placeId]: j.warnings ?? [] }));
      setHoursOverride((o) => ({ ...o, [placeId]: { opening_hours: j.opening_hours ?? null, hours_source: j.hours_source ?? null, hours_ref: j.hours_ref ?? null, hours_fetched_at: j.hours_fetched_at ?? null, hours_confirmed_at: j.hours_confirmed_at ?? null } }));
      setHoursVersion((v) => v + 1);
      set((c) => { if (!c.hours[placeId]) return c; const hours = { ...c.hours }; delete hours[placeId]; return { ...c, hours }; });
      return true;
    } catch {
      setHoursError((e) => ({ ...e, [placeId]: "Couldn't save the hours. Check your connection and try again." }));
      return false;
    } finally {
      setSavingId(null);
    }
  }
  function commitHours(placeId: string, typed: string) {
    const current = hoursOverride[placeId]?.opening_hours ?? places.find((p) => p.id === placeId)?.opening_hours ?? null;
    if (typed.trim() === (current ?? "")) return; // nothing changed
    // Everyday forms ("9am-6pm") become opening_hours syntax here; anything else goes to the server, which reads the full syntax.
    const n = normalizeHoursInput(typed);
    if (!n.ok && /^(Is that|Enter the hours)/.test(n.reason)) { setHoursError((e) => ({ ...e, [placeId]: n.reason })); return; }
    void patchHours(placeId, { value: n.ok ? n.hours : typed.trim() });
  }
  async function lookUpHours() {
    setLookup({ busy: true });
    try {
      const res = await fetch(`/api/trips/${tripId}/hours/lookup`, { method: "POST" });
      const j = (await res.json().catch(() => null)) as { outcomes?: LookupOutcome[]; error?: string } | null;
      if (!res.ok || !j?.outcomes) { setLookup({ busy: false, error: j?.error ?? "Couldn't look up opening hours just now. Try again later." }); return; }
      const outcomes = j.outcomes;
      const found = outcomes.filter((o): o is Extract<LookupOutcome, { result: "found" }> => o.result === "found");
      setHoursOverride((o) => ({ ...o, ...Object.fromEntries(found.map((f) => [f.placeId, { opening_hours: f.hours, hours_source: "map_data" as const, hours_ref: f.ref, hours_fetched_at: new Date().toISOString(), hours_confirmed_at: null }])) }));
      if (found.length) setHoursVersion((v) => v + 1);
      const count = (r: LookupOutcome["result"]) => outcomes.filter((o) => o.result === r).length;
      const n = { none: count("none"), ambiguous: count("ambiguous"), unreadable: count("unreadable"), loading: count("map_loading") };
      const parts = [
        found.length ? `Found hours for ${found.length} ${found.length === 1 ? "stop" : "stops"} in map data. Please check and confirm them.` : "No new hours were found in map data.",
        n.none ? `${n.none} ${n.none === 1 ? "stop has" : "stops have"} no hours in map data.` : "",
        n.ambiguous ? `${n.ambiguous} matched more than one mapped place with different hours, so we left ${n.ambiguous === 1 ? "it" : "them"} empty.` : "",
        n.unreadable ? `${n.unreadable} had hours in map data that we couldn't read.` : "",
        n.loading ? `Map data for ${n.loading} ${n.loading === 1 ? "stop" : "stops"} is still loading. Try again in a few minutes.` : "",
      ].filter(Boolean);
      setLookup({ busy: false, summary: parts.join(" ") });
    } catch {
      setLookup({ busy: false, error: "Couldn't look up opening hours just now. Check your connection and try again." });
    }
  }
  const jump = (step: NextStep) => step === "set-dates" ? (onSetDates ? onSetDates() : scrollTo("dates-heading")) : step === "plan-trip" ? (onPlanTrip ? onPlanTrip() : scrollTo("plan-assistant")) : step === "enter-hours" ? (setHoursOpen(true), scrollTo("trip-check")) : step === "set-departure" ? document.getElementById("check-date")?.focus() : undefined;
  // "Nothing looks impractical" is only said about stops we could actually check; with no known hours it is NOT an all-clear.
  const checkedCount = result ? result.verdicts.length - result.unverified : 0;
  const summaryLine = !result ? "" : result.problems > 0 ? `${result.problems} ${result.problems === 1 ? "stop needs" : "stops need"} a look.` : checkedCount === 0 ? "We can't tell yet whether your stops will be open." : "Nothing in the stops we could check looks impractical at this time.";
  function addHoursFor(placeId: string) { setHoursOpen(true); window.setTimeout(() => { const el = document.getElementById(`hours-${placeId}`); el?.scrollIntoView({ behavior: "smooth", block: "center" }); el?.focus(); }, 50); }
  const canJump = (i: ReadinessItem) => ["set-dates", "plan-trip", "enter-hours", "set-departure"].includes(i.next.step);
  const limits = general.items.filter((i) => i.severity !== "info");

  return (
    <section id="trip-check" aria-labelledby="check-heading" className="scroll-mt-24 rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="check-heading" className="font-display text-lg font-semibold text-pine">When should I leave?</h2>
          <p className="mt-0.5 text-sm text-ink-muted">Find the best time to set off, so each place is open when you get there. It only suggests; it never changes your plan.</p>
        </div>
        {onClose && <button type="button" onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sky" aria-label="Close When should I leave"><Glyph name="close" size={20} /></button>}
      </div>

      {limits.length > 0 && (
        <ul className="mt-4 space-y-2">
          {limits.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 rounded-2xl border border-marigold/40 bg-marigold-light/40 px-3.5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-pine">{i.title}</p>
                <p className="text-ink-muted">{i.message}</p>
                <p className="mt-1 text-xs text-ink-muted">Limits: {i.affects.map((f) => f.replace(/_/g, " ")).join(", ")}</p>
              </div>
              {canJump(i) && <Button size="sm" variant="secondary" onClick={() => jump(i.next.step)}>{i.next.label}</Button>}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Which day?" className="flex flex-wrap gap-2">
            {Array.from({ length: trip.num_days }, (_, i) => i + 1).map((d) => {
              const lbl = ((d: number) => { const dt = dateOfTripDay(trip.start_date, d); return dt ? formatDate(dt, { weekday: "short", day: "numeric", month: "short" }) : null; })(d);
              return <button key={d} type="button" role="radio" aria-checked={d === dayNo} onClick={() => set((c) => ({ ...c, day: d, date: "", ran: false }))} className={`min-h-11 rounded-full border-2 px-4 text-sm font-semibold ${d === dayNo ? "border-teal bg-teal-light/50 text-teal-ink" : "border-line text-ink-muted hover:border-teal/60"}`}>Day {d}{lbl ? ` · ${lbl}` : ""}</button>;
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={findBest} loading={advisor.busy && !s.ran} loadingLabel="Getting road times…"><Glyph name="navigate" size={16} />Find the best time to leave</Button>
            {s.time && typedMs !== null && <Button variant="secondary" onClick={run} loading={advisor.busy && s.ran} loadingLabel="Getting road times…"><Glyph name="check" size={16} />Check {time12(typedMs, INDIA_UTC_OFFSET_MIN)} instead</Button>}
          </div>

          <div ref={resultRef} id="departure-result" tabIndex={-1} aria-live="polite" className="scroll-mt-24 space-y-3 outline-none">
            {advisor.error && <p role="alert" className="rounded-2xl border border-clay/40 bg-clay-light/50 px-4 py-3 text-sm font-semibold text-clay-ink">{advisor.error}</p>}
            {advisor.busy && <p role="status" className="text-sm text-ink-muted">Getting the road times for this day…</p>}
            {!advisor.busy && advisor.asked > 0 && !s.ran && !advice && !advisor.error && (hoursLoading ? <p role="status" className="text-sm text-ink-muted">Reading the opening hours…</p> : !isRealISODate(date) ? (
              <div role="status" className="rounded-2xl border border-marigold/50 bg-marigold-light/50 px-4 py-3 text-sm"><p className="font-semibold text-pine">Choose a date first</p><p className="text-ink-muted">Opening hours depend on the day of the week, so pick the date you will travel (or set your trip dates).</p><Button size="sm" variant="secondary" className="mt-2" onClick={() => jump("set-dates")}>Set trip dates</Button></div>
            ) : dayStops.length === 0 ? <p role="status" className="rounded-2xl border border-line bg-sky/50 px-4 py-3 text-sm text-ink-muted">There are no stops on Day {dayNo} yet, so there is nothing to time. Add a place to this day, or pick another day.</p> : null)}
            {advice && !s.ran && <AdviceCard advice={advice} passed={nowMs > 0 && advice.departureMs !== null && advice.departureMs < nowMs} />}
          </div>

          <details className="rounded-xl border border-line">
            <summary className="flex min-h-11 cursor-pointer items-center px-3.5 text-sm font-semibold text-pine">Try a specific time{!tripDay ? " or date" : ""}</summary>
            <div className="grid grid-cols-1 gap-3 border-t border-line px-3.5 pb-3.5 pt-3 sm:grid-cols-2">
              {!tripDay && (
                <div>
                  <label htmlFor="check-date" className="text-sm font-semibold text-pine">Leave on</label>
                  <input id="check-date" type="date" value={date} onChange={(e) => set((c) => ({ ...c, date: e.target.value, ran: false }))} className="mt-1.5 min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base" />
                </div>
              )}
              <div>
                <label htmlFor="check-time" className="text-sm font-semibold text-pine">Leave at</label>
                <input id="check-time" type="time" value={s.time} onChange={(e) => set((c) => ({ ...c, time: e.target.value, ran: false }))} className="mt-1.5 min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base" />
              </div>
            </div>
          </details>
          <details className="rounded-xl border border-line">
            <summary className="flex min-h-11 cursor-pointer items-center px-3.5 text-sm font-semibold text-pine">How this works</summary>
            <div className="space-y-2 border-t border-line px-3.5 pb-3.5 pt-3 text-sm text-ink-muted">
              <p>We use the road time to each stop, a break every couple of hours and your time at each place. Opening hours come from your group or from map data; if we don&apos;t have a place&apos;s hours, we say so.</p>
              <p>{dayNo === 1 ? `Driving starts from ${trip.start_city ?? "your start"}` : "Driving starts from where you stopped the night before"}. Times are in India time. Driving times are estimates for a car at typical speeds, with a short break every couple of hours, and no live traffic.</p>
            </div>
          </details>

          <div>
            <button type="button" aria-expanded={hoursOpen} onClick={() => setHoursOpen((o) => !o)} className="tm-action inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold">
              <Glyph name={hoursOpen ? "up" : "down"} size={14} />Opening hours for this day ({dayStops.filter((p) => hoursOf(p).opening_hours).length} of {dayStops.length} known)
            </button>
            {hoursOpen && (
              <div className="mt-2 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void lookUpHours()} disabled={lookup.busy}>{lookup.busy ? "Looking up\u2026" : "Look up hours from map data"}</Button>
                  <span className="text-xs text-ink-muted">Searches OpenStreetMap for this trip&apos;s stops. Many places have no hours there, and we never fill in a guess.</span>
                </div>
                {lookup.summary && <p role="status" className="rounded-xl bg-sky/50 px-3 py-2 text-sm text-ink-muted">{lookup.summary}</p>}
                {lookup.error && <p role="alert" className="text-sm font-semibold text-clay-ink">{lookup.error}</p>}
                <ul className="space-y-2.5">
                  {dayStops.length === 0 && <li className="text-sm text-ink-muted">There are no stops on this day yet.</li>}
                  {dayStops.map((p) => {
                    const h = hoursOf(p);
                    const legacy = !h.opening_hours ? s.hours[p.id] : undefined;
                    const unconfirmed = h.hours_source === "map_data" && !h.hours_confirmed_at;
                    const busy = savingId === p.id;
                    return (
                      <li key={p.id} className="rounded-xl bg-sky/50 p-3">
                        <label htmlFor={`hours-${p.id}`} className="text-sm font-semibold text-pine">{p.name}</label>
                        <input key={`${p.id}:${h.opening_hours ?? ""}`} id={`hours-${p.id}`} type="text" defaultValue={h.opening_hours ?? ""} disabled={busy} placeholder="e.g. 9am-6pm or Mo-Sa 09:00-17:30; Su off" onBlur={(e) => commitHours(p.id, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitHours(p.id, e.currentTarget.value); }} className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base" aria-describedby={`hours-note-${p.id}`} />
                        <p id={`hours-note-${p.id}`} className={`mt-1 text-xs ${hoursError[p.id] ? "font-semibold text-clay-ink" : "text-ink-muted"}`} role={hoursError[p.id] ? "alert" : undefined}>
                          {busy ? "Saving\u2026" : hoursError[p.id] ?? (h.opening_hours ? sourceLine(h) : "Unknown. Leave it empty if you don't know: we won't guess. Saved hours are shared with everyone on this trip.")}
                        </p>
                        {(hoursWarn[p.id] ?? []).map((m) => <p key={m} className="mt-0.5 text-xs text-[#7a4a00]">{m}</p>)}
                        {(unconfirmed || h.opening_hours || legacy) && (
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            {unconfirmed && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void patchHours(p.id, { confirm: true })}>These hours are right</Button>}
                            {h.opening_hours && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void patchHours(p.id, { value: null })}>Remove hours</Button>}
                            {legacy && <Button size="sm" variant="secondary" disabled={busy} onClick={() => commitHours(p.id, legacy.typed || legacy.hours)}>Save &ldquo;{legacy.typed || legacy.hours}&rdquo; to the trip</Button>}
                          </div>
                        )}
                        {legacy && <p className="mt-1 text-xs text-ink-muted">You typed these hours earlier and they were kept only on this device, so the check no longer uses them. Save them to use them and share them with the group.</p>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          {s.ran && !readiness.canProceed && (
            <div role="status" className="rounded-2xl border border-marigold/50 bg-marigold-light/50 px-4 py-3 text-sm">
              <p className="font-semibold text-pine">{readiness.headline}</p>
              <ul className="mt-1.5 space-y-1.5">{readiness.items.filter((i) => i.severity === "blocker").map((i) => <li key={i.id} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 flex-1 text-ink-muted">{i.message}</span>{canJump(i) && i.next.step !== "set-departure" && <Button size="sm" variant="secondary" onClick={() => jump(i.next.step)}>{i.next.label}</Button>}</li>)}</ul>
            </div>
          )}

          {s.ran && readiness.canProceed && hoursLoading && <p role="status" className="text-sm text-ink-muted">Reading the opening hours…</p>}

          {result && (
            <div className="space-y-2.5">
              <h3 className="text-sm font-semibold text-pine">{useTyped ? `If you leave at ${time12(departureMs as number, INDIA_UTC_OFFSET_MIN)}: will each place be open?` : "At that time, will each place be open when you arrive?"}</h3>
              <p className="text-sm font-semibold text-pine">{summaryLine}{result.unverified > 0 && <span className="font-normal text-ink-muted"> {result.unverified} {result.unverified === 1 ? "stop has" : "stops have"} no hours we can check.</span>}</p>
              <ol className="space-y-2.5">
                {result.verdicts.map((v) => {
                  const t = tone[v.severity];
                  return (
                    <li key={v.stopId} className={`rounded-2xl border px-3.5 py-3 ${t.box}`}>
                      <div className="flex items-start gap-3">
                        <Glyph name={t.icon} size={18} className={`mt-0.5 ${t.text}`} />
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-baseline gap-x-2"><strong className="text-pine">{v.name}</strong>{v.arriveClock && <span className="text-xs font-semibold text-ink-muted">arrive about {clock12(v.arriveClock)}{v.dayShift ? ` (${v.dayShift})` : ""}</span>}</p>
                          <p className={`text-sm font-semibold ${t.text}`}><span className="mr-2 inline-block rounded-full bg-white/70 px-2 py-0.5 text-xs">{ANSWER[v.state]?.label ?? v.headline}</span>{v.headline}</p>
                          <p className="text-sm text-ink-muted">{v.detail}</p>
                          {v.windowClock && v.state !== "needs_drive_time" && <p className="mt-1 text-xs text-ink-muted">Arrival could be anywhere from {localizeClocks(v.windowClock).replace("–", " to ")}.{v.night && " This is a night arrival."}</p>}
                          {v.hoursSource === "user" && v.state !== "hours_unverified" && <p className="text-xs text-ink-muted">Based on hours entered by a trip member.</p>}
                          {v.hoursSource === "osm" && v.state !== "hours_unverified" && <p className="text-xs text-ink-muted">Based on map data (OpenStreetMap){stops.find((x) => x.id === v.stopId)?.hoursConfirmed ? ", confirmed by a trip member" : ", not confirmed"}.</p>}
                          {v.state === "hours_unverified" && v.options.includes("enter_hours") && <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => addHoursFor(v.stopId)}>{v.hoursSource ? "Check its opening hours" : "Add its opening hours"}</Button></div>}
                          {(v.severity === "warn" || v.severity === "risk") && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {v.fix?.minutes && (v.fix.kind === "leave_earlier" || v.fix.kind === "leave_later") && <Button size="sm" variant="secondary" onClick={() => shift(v)}>Try leaving {durationLabel(v.fix.minutes)} {v.fix.kind === "leave_earlier" ? "earlier" : "later"}</Button>}
                              {v.fix?.kind === "next_day" && <Button size="sm" variant="secondary" onClick={nextDay}>Check the next day</Button>}
                              <span className="text-xs text-ink-muted">You could: {v.options.filter((o) => o !== "continue").map((o) => OPTION_LABEL[o].toLowerCase()).join(" · ")}.</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {result.endClock && <p className="text-xs text-ink-muted">You&apos;d finish around {clock12(result.endClock)}{result.endsMs !== null && departureMs !== null && dateOf(result.endsMs, INDIA_UTC_OFFSET_MIN) !== dateOf(departureMs, INDIA_UTC_OFFSET_MIN) ? " (the next day)" : ""} if everything goes to plan.</p>}
              <p className="text-xs text-ink-muted">Opening hours don&apos;t guarantee entry, tickets, or that a place is running normally that day: holidays, festivals and repairs can change them.</p>
            </div>
          )}

          {result && timeline.length > 2 && (
            <div>
              <h3 className="text-sm font-semibold text-pine">Your day ahead</h3>
              <ol className="mt-2 space-y-3 border-l-2 border-line pl-4">
                {timeline.map((i) => <TimelineRow key={i.id} item={i} />)}
              </ol>
              <p className="mt-2 text-xs text-ink-muted">Times are estimates from your departure. Terrain timing is approximate. Forecasts are shown only when we have one for that stop.</p>
            </div>
          )}

          <div className="rounded-2xl border border-line bg-white px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-pine"><Glyph name="trek" size={16} className="text-teal" />Hills on this route</p>
            {!canTerrain ? (
              <p className="mt-1 text-xs text-ink-muted">{dayNo !== activeDay ? `Show Day ${dayNo} on the plan above to read the height of its road.` : "The road for this day hasn't loaded yet."}</p>
            ) : !terrainOn ? (
              <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => setTerrainOn(true)}>Check for hills</Button><p className="mt-1.5 text-xs text-ink-muted">Shows whether this day&apos;s drive climbs into hills or mountains, and where, so you know what kind of drive to expect. It reads the height of the ground along the road. It can&apos;t tell you about bends or road condition.</p></div>
            ) : terrain.loading ? (
              <p role="status" className="mt-1 text-sm text-ink-muted">Reading the height of the road…</p>
            ) : terrain.error ? (
              <p role="alert" className="mt-1 text-sm font-semibold text-clay-ink">{terrain.error}</p>
            ) : terrain.result && (
              <div className="mt-1.5 space-y-2 text-sm">
                {(() => {
                  const ch = routeCharacter(terrain.result.segments, terrain.result.stats);
                  const links = hillStationLinks(terrain.result.segments, dayStops.map((p) => ({ id: p.id, name: p.name, category: normalizeCategory(p.category), kmAlong: roadLine ? kmAlongLine(roadLine, p) : null })));
                  const notes = implications(terrain.result.segments);
                  return (
                    <>
                      <p className="font-semibold text-pine">{ch.headline}</p>
                      <p className="text-ink-muted">{ch.detail}{terrain.result.stats && ch.kind !== "flat" ? ` The highest point is about ${terrain.result.stats.maxM} m, the lowest about ${terrain.result.stats.minM} m.` : ""}</p>
                      <Sparkline profile={terrain.result.profile} label={terrain.result.stats ? `Height along the route, from ${terrain.result.stats.minM} to ${terrain.result.stats.maxM} metres` : "Height along the route"} />
                      {links.map((l) => <p key={l.stop.id} className="rounded-xl bg-marigold-light/60 px-3 py-2 font-semibold text-pine">{linkSentence(l)}</p>)}
                      {terrain.result.segments.length > 0 && <ul className="space-y-1.5">{terrain.result.segments.map((g) => <li key={`${g.kind}${g.startKm}`} className={`rounded-xl px-3 py-2 ${g.steepness === "steep" ? "bg-marigold-light/60" : "bg-sky/60"}`}><p className="font-semibold text-pine">{g.headline}</p><p className="text-xs text-ink-muted">Starts about {Math.round(g.startKm)} km from where this day&apos;s drive begins. {g.detail}</p></li>)}</ul>}
                      {notes.length > 0 && <ul className="list-disc space-y-1 pl-5 text-ink-muted">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
                      <p className="text-xs text-ink-muted">{NOT_ASSESSED}</p>
                    </>
                  );
                })()}
                <p className="text-xs text-ink-muted">Source: {terrain.result.source.label}. Heights are approximate.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {shown.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-pine">Alerts for this trip</h3>
          <ul className="mt-2 space-y-2" role="list">
            {shown.map(({ e, d }) => (
              <li key={e.id} role={d.level <= 2 ? "alert" : undefined} className={`rounded-2xl border px-3.5 py-3 text-sm ${d.level <= 2 ? "border-clay/40 bg-clay-light/50" : "border-line bg-sky/50"}`}>
                <p className="font-semibold text-pine">{e.title}</p>
                <p className="text-ink-muted">{e.impact}{e.action ? ` ${e.action}` : ""}</p>
                {e.confidence !== "high" && <p className="mt-0.5 text-xs text-ink-muted">We&apos;re only {e.confidence === "medium" ? "fairly" : "partly"} sure about this ({e.dataStatus.replace(/_/g, " ")}).</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => set((c) => ({ ...c, states: { ...c.states, [e.id]: { ...c.states[e.id], dismissedAt: nowMs, dismissedAtSeverity: e.severity } } }))}>Dismiss</Button>
                  {d.level > 1 && <Button size="sm" variant="ghost" onClick={() => set((c) => ({ ...c, states: { ...c.states, [e.id]: { ...c.states[e.id], snoozedUntil: nowMs + DEFAULT_PREFS.snoozeMs } } }))}>Remind me in 2 hours</Button>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(parked.length > 0 || resolved.length > 0) && (
        <details className="mt-4 rounded-2xl bg-sky/40 px-4 py-2.5">
          <summary className="min-h-9 cursor-pointer text-sm font-semibold text-pine">Dismissed and snoozed alerts ({parked.length + resolved.length})</summary>
          <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
            {parked.map(({ e, d }) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2"><span>{e.title}: {d.suppressedBecause?.toLowerCase()}</span><Button size="sm" variant="ghost" onClick={() => set((c) => { const st = { ...c.states }; delete st[e.id]; return { ...c, states: st }; })}>Show again</Button></li>
            ))}
            {resolved.map(([id, r]) => <li key={id}>{r.title}: no longer applies</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

const DOT: Record<TimelineItem["tone"], string> = { ok: "bg-teal", info: "bg-[#6aa6c9]", warn: "bg-marigold", risk: "bg-clay" };
const BASIS: Record<TimelineItem["basis"], string> = { estimate: "Estimate", published: "From opening hours on file", forecast: "Forecast", "terrain-model": "From elevation data", plan: "Your plan" };

function TimelineRow({ item }: { item: TimelineItem }) {
  return (
    <li className="relative">
      <span aria-hidden="true" className={`absolute -left-[1.45rem] top-1.5 h-3 w-3 rounded-full ring-4 ring-white ${DOT[item.tone]}`} />
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs text-ink-muted">{item.atClock ? `${item.approximate ? "~" : ""}${clock12(item.atClock)}${item.dayShift ? ` (${item.dayShift})` : ""}` : "later"}</span>
        <strong className="text-pine">{item.title}</strong>
      </p>
      <p className="text-sm text-ink-muted">{item.detail}</p>
      <span className="mt-0.5 inline-block rounded-full bg-sky px-2 py-0.5 text-[11px] font-semibold text-ink-muted">{BASIS[item.basis]}</span>
    </li>
  );
}

/** The height of the road as a small line chart, with the numbers in its label for people who cannot see it. */
function Sparkline({ profile, label }: { profile: { km: number; elevM: number }[]; label: string }) {
  if (profile.length < 2) return null;
  const w = 300, h = 56;
  const maxKm = profile[profile.length - 1].km || 1;
  const lo = Math.min(...profile.map((p) => p.elevM)), hi = Math.max(...profile.map((p) => p.elevM));
  const pts = profile.map((p) => `${((p.km / maxKm) * w).toFixed(1)},${(h - 4 - ((p.elevM - lo) / (hi - lo || 1)) * (h - 8)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" role="img" aria-label={label} preserveAspectRatio="none">
      <polyline points={`0,${h} ${pts} ${w},${h}`} fill="rgba(28,124,109,0.12)" stroke="none" />
      <polyline points={pts} fill="none" stroke="#1C7C6D" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const ADVICE_TITLE: Record<string, string> = { recommended: "Best time to leave", no_hours_known: "A sensible time to leave", no_good_time: "The closest we can get", cannot_calculate: "We can't work this out yet" };

/** The recommended departure, why, what else works, what it costs you, and what it assumes. Facts and guesses are kept apart. */
function AdviceCard({ advice, passed }: { advice: ReturnType<typeof recommendDeparture>; passed: boolean }) {
  const t = advice.status === "recommended" ? tone.ok : advice.status === "no_hours_known" ? tone.info : tone.warn;
  return (
    <div className={`rounded-2xl border px-4 py-4 ${t.box}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{ADVICE_TITLE[advice.status]}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-pine">{advice.headline}</p>
      <p className="mt-1.5 text-sm text-ink-muted">{advice.reason}</p>
      {passed && <p role="status" className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-sm font-semibold text-clay-ink">That time has already passed today. Leave as soon as you can, or choose a later date.</p>}
      {advice.range && advice.range.fromMs !== advice.range.toMs && <p className="mt-2 text-sm text-pine"><strong>Anything from {advice.range.label}</strong> works too.</p>}
      {advice.tradeoffs.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-semibold text-pine">Things to know</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted">{advice.tradeoffs.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      <details className="mt-3">
        <summary className="tm-action flex min-h-11 cursor-pointer items-center text-sm font-semibold">What this assumes</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted">{advice.assumptions.map((x) => <li key={x}>{x}</li>)}<li>Opening hours don&apos;t guarantee entry: holidays, festivals and repairs can change them.</li></ul>
      </details>
    </div>
  );
}
