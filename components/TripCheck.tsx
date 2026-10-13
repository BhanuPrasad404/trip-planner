"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { useLocalJson } from "@/lib/client/use-local-json";
import { useNowMinute } from "@/lib/client/use-now";
import { dateOfTripDay } from "@/lib/dates";
import { isoDate } from "@/lib/time-context";
import { INDIA_UTC_OFFSET_MIN, clockOf, dateOf, durationLabel, localToUtcMs } from "@/lib/travel/clock";
import { eventsFromReadiness, eventsFromVerdicts, type TravelEvent } from "@/lib/travel/events";
import { checkDeparture, type FeasStop, type Option, type StopVerdict } from "@/lib/travel/feasibility";
import { assessObservation, ageLabel } from "@/lib/travel/freshness";
import { normalizeHoursInput } from "@/lib/travel/hours-input";
import { DEFAULT_PREFS, decide, type Decision, type EventState } from "@/lib/travel/notify-policy";
import { checkReadiness, type NextStep, type ReadinessItem } from "@/lib/travel/readiness";
import type { Place, Trip } from "@/lib/types";
import type { Conditions } from "@/lib/weather";
import { useTerrain } from "@/lib/client/use-terrain";
import { buildTimeline, type TimelineItem } from "@/lib/travel/timeline";
import { weatherVisual } from "@/lib/travel/weather-visual";

type Stored = {
  date: string;
  time: string;
  day: number | null;
  ran: boolean;
  /** Hours the traveller typed in for a stop: the strict form the engine reads, what they typed, and when. */
  hours: Record<string, { hours: string; typed: string; at: number }>;
  states: Record<string, EventState>;
  seen: Record<string, { title: string }>;
};
const EMPTY: Stored = { date: "", time: "", day: null, ran: false, hours: {}, states: {}, seen: {} };

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
export function TripCheck({ tripId, trip, places, activeDay, today, conditions = {}, roadLine = null }: { tripId: string; trip: Trip; places: Place[]; activeDay: number; today: string; conditions?: Record<string, Conditions>; /** The real road for the day shown on the plan, when it has loaded. */ roadLine?: [number, number][] | null }) {
  const [s, set] = useLocalJson<Stored>(`tm:trip-check:${tripId}`, EMPTY);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [hoursError, setHoursError] = useState<Record<string, string>>({});
  const [terrainOn, setTerrainOn] = useState(false);
  const nowMs = useNowMinute() * 60_000; // 0 until the browser clock is ready

  const dayNo = s.day ?? activeDay;
  const dayStops = useMemo(() => places.filter((p) => p.day_number === dayNo).sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0)), [places, dayNo]);
  const tripDay = dateOfTripDay(trip.start_date, dayNo);
  const date = s.date || (tripDay ? isoDate(tripDay) : "");
  const forReadiness = (p: Place) => ({ id: p.id, name: p.name, day_number: p.day_number, sequence_order: p.sequence_order, arrival_time: p.arrival_time, drive_minutes: p.drive_minutes, hours: s.hours[p.id]?.hours ?? null });

  const general = useMemo(() => checkReadiness({ action: "plan", todayISO: today, trip, places: places.map(forReadiness) }), [today, trip, places, s.hours]); // eslint-disable-line react-hooks/exhaustive-deps -- forReadiness only reads s.hours and p
  const readiness = useMemo(
    () => checkReadiness({ action: "check-departure", todayISO: today, trip, places: dayStops.map(forReadiness), departure: { date: date || null, time: s.time || null } }),
    [today, trip, dayStops, date, s.time, s.hours] // eslint-disable-line react-hooks/exhaustive-deps -- as above
  );

  const departureMs = date && s.time ? localToUtcMs(date, s.time, INDIA_UTC_OFFSET_MIN) : null;
  const stops: FeasStop[] = useMemo(() => dayStops.map((p) => ({
    id: p.id, name: p.name, driveMin: p.drive_minutes, visitMin: p.visit_minutes ?? Math.round(CATEGORIES[normalizeCategory(p.category)].hours * 60),
    hours: s.hours[p.id]?.hours ?? null, hoursSource: s.hours[p.id] ? ("user" as const) : null,
  })), [dayStops, s.hours]);
  const result = useMemo(() => (s.ran && readiness.canProceed && departureMs !== null ? checkDeparture({ departureMs, stops }) : null), [s.ran, readiness.canProceed, departureMs, stops]);

  // Terrain is fetched only when asked, and only for the day whose road is on the plan.
  const canTerrain = dayNo === activeDay && !!roadLine && roadLine.length >= 2;
  const terrain = useTerrain(canTerrain ? roadLine : null, terrainOn && canTerrain);
  const timeline = useMemo(
    () => (result && departureMs !== null
      ? buildTimeline({
          departureMs, utcOffsetMin: INDIA_UTC_OFFSET_MIN,
          stops: dayStops.map((p, i) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, visitMin: stops[i]?.visitMin ?? 60 })),
          verdicts: result.verdicts, line: canTerrain ? roadLine : null, terrain: terrain.result?.segments ?? null,
          weather: Object.fromEntries(dayStops.map((p) => [p.id, weatherVisual(conditions[p.id] ?? null, normalizeCategory(p.category))])),
        })
      : []),
    [result, departureMs, dayStops, stops, canTerrain, roadLine, terrain.result, conditions]
  );

  // Events and what the policy says about each (only once the browser clock is known, so server and browser agree on first paint).
  const events: { e: TravelEvent; d: Decision }[] = useMemo(() => {
    if (!s.ran || !nowMs) return [];
    const found = [...(result ? eventsFromVerdicts(tripId, result.verdicts, nowMs) : []), ...eventsFromReadiness(tripId, readiness.items, nowMs)];
    return found.map((e) => ({ e, d: decide(e, s.states[e.id] ?? {}, DEFAULT_PREFS, nowMs, INDIA_UTC_OFFSET_MIN) }));
  }, [s.ran, nowMs, result, readiness.items, s.states, tripId]);
  const shown = events.filter(({ e, d }) => e.severity !== "info" && d.deliver !== "none" && d.suppressedBecause !== "Dismissed" && d.suppressedBecause !== "Snoozed");
  const parked = events.filter(({ e, d }) => e.severity !== "info" && (d.suppressedBecause === "Dismissed" || d.suppressedBecause === "Snoozed"));
  const currentIds = new Set(events.map(({ e }) => e.id));
  const resolved = Object.entries(s.seen).filter(([id]) => !currentIds.has(id));

  function run() { set((c) => ({ ...c, ran: true, seen: { ...c.seen, ...Object.fromEntries(events.map(({ e }) => [e.id, { title: e.title }])) } })); }
  function shift(verdict: StopVerdict) {
    if (departureMs === null || !verdict.fix?.minutes) return;
    const dir = verdict.fix.kind === "leave_earlier" ? -1 : 1;
    const next = departureMs + dir * verdict.fix.minutes * 60_000;
    set((c) => ({ ...c, date: dateOf(next, INDIA_UTC_OFFSET_MIN), time: clockOf(next, INDIA_UTC_OFFSET_MIN), ran: true }));
  }
  function nextDay() { if (!date) return; const n = (departureMs ?? localToUtcMs(date, "12:00", INDIA_UTC_OFFSET_MIN)!) + 24 * 3_600_000; set((c) => ({ ...c, date: dateOf(n, INDIA_UTC_OFFSET_MIN), ran: true })); }
  function commitHours(placeId: string, typed: string) {
    const r = normalizeHoursInput(typed);
    if (!r.ok) { setHoursError((e) => ({ ...e, [placeId]: r.reason })); return; }
    setHoursError((e) => { const { [placeId]: _drop, ...rest } = e; void _drop; return rest; });
    set((c) => { const hours = { ...c.hours }; if (r.hours === null) delete hours[placeId]; else hours[placeId] = { hours: r.hours, typed: typed.trim(), at: nowMs || Date.now() }; return { ...c, hours }; });
  }
  const jump = (step: NextStep) => step === "set-dates" ? scrollTo("dates-heading") : step === "plan-trip" ? scrollTo("plan-assistant") : step === "enter-hours" ? (setHoursOpen(true), scrollTo("trip-check")) : step === "set-departure" ? document.getElementById("check-date")?.focus() : undefined;
  const canJump = (i: ReadinessItem) => ["set-dates", "plan-trip", "enter-hours", "set-departure"].includes(i.next.step);
  const limits = general.items.filter((i) => i.severity !== "info");

  return (
    <section id="trip-check" aria-labelledby="check-heading" className="scroll-mt-24 rounded-3xl border border-line bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky text-pine"><Glyph name="checkCircle" size={20} /></span>
          <div className="min-w-0">
            <h2 id="check-heading" className="font-display text-xl font-semibold text-pine">Trip check</h2>
            <p className="text-sm text-ink-muted">What is missing, and whether your plan works at the time you leave. It only suggests; it never changes your plan.</p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${limits.length ? "bg-marigold-light text-[#7a4a00]" : "bg-teal-light text-teal-ink"}`}>{general.headline}</span>
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

      <details className="mt-4 rounded-2xl border border-line" open={s.ran}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-[15px] font-semibold text-pine [&::-webkit-details-marker]:hidden"><Glyph name="car" size={17} className="text-teal" />Will it be open when I arrive?</summary>
        <div className="space-y-4 border-t border-line px-4 pb-4 pt-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="check-day" className="text-sm font-semibold text-pine">Day</label>
              <select id="check-day" value={dayNo} onChange={(e) => set((c) => ({ ...c, day: Number(e.target.value), date: "", ran: false }))} className="mt-1.5 min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base">
                {Array.from({ length: trip.num_days }, (_, i) => i + 1).map((d) => <option key={d} value={d}>Day {d}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="check-date" className="text-sm font-semibold text-pine">Leave on</label>
              <input id="check-date" type="date" value={date} onChange={(e) => set((c) => ({ ...c, date: e.target.value, ran: false }))} className="mt-1.5 min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base" />
            </div>
            <div>
              <label htmlFor="check-time" className="text-sm font-semibold text-pine">Leave at</label>
              <input id="check-time" type="time" value={s.time} onChange={(e) => set((c) => ({ ...c, time: e.target.value, ran: false }))} className="mt-1.5 min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base" />
            </div>
          </div>
          <p className="text-xs text-ink-muted">{dayNo === 1 ? `From ${trip.start_city ?? "your start"}` : "From where you stopped the night before"}. Times are in India time. Driving times are estimates for a car at typical speeds, with a short break every couple of hours, and no live traffic.</p>

          <div>
            <button type="button" aria-expanded={hoursOpen} onClick={() => setHoursOpen((o) => !o)} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-teal-ink underline underline-offset-2">
              <Glyph name={hoursOpen ? "up" : "down"} size={14} />Opening hours I know ({Object.keys(s.hours).filter((id) => dayStops.some((p) => p.id === id)).length} of {dayStops.length})
            </button>
            {hoursOpen && (
              <ul className="mt-2 space-y-2.5">
                {dayStops.length === 0 && <li className="text-sm text-ink-muted">There are no stops on this day yet.</li>}
                {dayStops.map((p) => {
                  const h = s.hours[p.id];
                  const a = h ? assessObservation({ kind: "user_input", provider: "you", value: h.hours, retrievedAt: h.at, basis: "user" }, nowMs || h.at) : null;
                  return (
                    <li key={p.id} className="rounded-xl bg-sky/50 p-3">
                      <label htmlFor={`hours-${p.id}`} className="text-sm font-semibold text-pine">{p.name}</label>
                      <input id={`hours-${p.id}`} type="text" defaultValue={h?.typed ?? ""} placeholder="e.g. 9am-6pm or Mo-Sa 09:00-17:30" onBlur={(e) => commitHours(p.id, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitHours(p.id, e.currentTarget.value); }} className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base" aria-describedby={`hours-note-${p.id}`} />
                      <p id={`hours-note-${p.id}`} className={`mt-1 text-xs ${hoursError[p.id] ? "font-semibold text-clay-ink" : "text-ink-muted"}`} role={hoursError[p.id] ? "alert" : undefined}>
                        {hoursError[p.id] ?? (h ? `Hours you entered ${a ? `${ageLabel(a.ageMs ?? 0)} ago` : ""}${a && a.status === "potentially_outdated" ? ". They may be out of date." : "."}` : "Leave empty if you don't know. We won't guess.")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <Button onClick={run}><Glyph name="check" size={16} />Check my departure</Button>

          {s.ran && !readiness.canProceed && (
            <div role="status" className="rounded-2xl border border-marigold/50 bg-marigold-light/50 px-4 py-3 text-sm">
              <p className="font-semibold text-pine">{readiness.headline}</p>
              <ul className="mt-1.5 space-y-1.5">{readiness.items.filter((i) => i.severity === "blocker").map((i) => <li key={i.id} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 flex-1 text-ink-muted">{i.message}</span>{canJump(i) && i.next.step !== "set-departure" && <Button size="sm" variant="secondary" onClick={() => jump(i.next.step)}>{i.next.label}</Button>}</li>)}</ul>
            </div>
          )}

          {result && (
            <div aria-live="polite" className="space-y-2.5">
              <p className="text-sm font-semibold text-pine">{result.problems === 0 ? "Nothing in your day looks impractical at this time." : `${result.problems} ${result.problems === 1 ? "stop needs" : "stops need"} a look.`}{result.unverified > 0 && <span className="font-normal text-ink-muted"> {result.unverified} {result.unverified === 1 ? "has" : "have"} no hours we can check.</span>}</p>
              <ol className="space-y-2.5">
                {result.verdicts.map((v) => {
                  const t = tone[v.severity];
                  return (
                    <li key={v.stopId} className={`rounded-2xl border px-3.5 py-3 ${t.box}`}>
                      <div className="flex items-start gap-3">
                        <Glyph name={t.icon} size={18} className={`mt-0.5 ${t.text}`} />
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-baseline gap-x-2"><strong className="text-pine">{v.name}</strong>{v.arriveClock && <span className="font-mono text-xs text-ink-muted">arrive {v.arriveClock}{v.dayShift ? ` (${v.dayShift})` : ""}</span>}</p>
                          <p className={`text-sm font-semibold ${t.text}`}>{v.headline}</p>
                          <p className="text-sm text-ink-muted">{v.detail}</p>
                          {v.windowClock && v.state !== "needs_drive_time" && <p className="mt-1 text-xs text-ink-muted">Arrival could be anywhere from {v.windowClock.replace("–", " to ")}.{v.night && " This is a night arrival."}</p>}
                          {v.hoursSource === "user" && <p className="text-xs text-ink-muted">Based on the hours you entered.</p>}
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
              {result.endClock && <p className="text-xs text-ink-muted">You&apos;d finish around {result.endClock} if everything goes to plan.</p>}
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
            <p className="flex items-center gap-2 text-sm font-semibold text-pine"><Glyph name="trek" size={16} className="text-teal" />Terrain on this route</p>
            {!canTerrain ? (
              <p className="mt-1 text-xs text-ink-muted">{dayNo !== activeDay ? `Show Day ${dayNo} on the plan above to read the height of its road.` : "The road for this day hasn't loaded yet."}</p>
            ) : !terrainOn ? (
              <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => setTerrainOn(true)}>Check the terrain</Button><p className="mt-1.5 text-xs text-ink-muted">Reads the height of the ground along the road. It tells you about climbs and descents. It doesn&apos;t know road condition or mobile coverage.</p></div>
            ) : terrain.loading ? (
              <p role="status" className="mt-1 text-sm text-ink-muted">Reading the height of the road…</p>
            ) : terrain.error ? (
              <p role="alert" className="mt-1 text-sm font-semibold text-clay-ink">{terrain.error}</p>
            ) : terrain.result && (
              <div className="mt-1.5 space-y-2 text-sm">
                {terrain.result.stats && <p className="text-ink-muted">Highest point about <strong className="text-pine">{terrain.result.stats.maxM} m</strong>, lowest about <strong className="text-pine">{terrain.result.stats.minM} m</strong>. Total climbing about <strong className="text-pine">{terrain.result.stats.totalClimbM} m</strong> over {terrain.result.totalKm} km.</p>}
                <Sparkline profile={terrain.result.profile} label={terrain.result.stats ? `Height along the route, from ${terrain.result.stats.minM} to ${terrain.result.stats.maxM} metres` : "Height along the route"} />
                {terrain.result.segments.length === 0 ? <p className="text-ink-muted">No long climbs or descents were found on this road. The ground is fairly gentle.</p> : (
                  <ul className="space-y-1.5">{terrain.result.segments.map((g) => <li key={`${g.kind}${g.startKm}`} className={`rounded-xl px-3 py-2 ${g.steepness === "steep" ? "bg-marigold-light/60" : "bg-sky/60"}`}><p className="font-semibold text-pine">{g.headline}</p><p className="text-xs text-ink-muted">Starts about {Math.round(g.startKm)} km from the start. {g.detail}</p></li>)}</ul>
                )}
                <p className="text-xs text-ink-muted">Source: {terrain.result.source.label}. Heights are approximate. We have no road-condition or mobile-coverage data, so we say nothing about those.</p>
              </div>
            )}
          </div>
        </div>
      </details>

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
          <summary className="min-h-9 cursor-pointer text-sm font-semibold text-pine">Alert history ({parked.length + resolved.length})</summary>
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
const BASIS: Record<TimelineItem["basis"], string> = { estimate: "Estimate", published: "From hours you entered", forecast: "Forecast", "terrain-model": "From elevation data", plan: "Your plan" };

function TimelineRow({ item }: { item: TimelineItem }) {
  return (
    <li className="relative">
      <span aria-hidden="true" className={`absolute -left-[1.45rem] top-1.5 h-3 w-3 rounded-full ring-4 ring-white ${DOT[item.tone]}`} />
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs text-ink-muted">{item.atClock ? `${item.approximate ? "~" : ""}${item.atClock}${item.dayShift ? ` (${item.dayShift})` : ""}` : "later"}</span>
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
