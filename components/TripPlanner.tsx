"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { useNowMinute } from "@/lib/client/use-now";
import { useTripRealtime } from "@/lib/client/use-trip-realtime";
import { dateOfTripDay } from "@/lib/dates";
import { formatDate, formatDuration } from "@/lib/format";
import { computeGoScore, type GoScore } from "@/lib/goscore";
import { getSeasonStatus, visitMonth } from "@/lib/season";
import type { Place, PlaceWithSeason, Trip, TripMember } from "@/lib/types";
import type { VoteSummary } from "@/lib/votes";
import type { Conditions } from "@/lib/weather";
import { findFarPins } from "@/lib/pin-check";
import { buildAlerts } from "@/lib/alerts";
import type { ReportView } from "@/lib/reports";
import { AddPlaceForm } from "./AddPlaceForm";
import { ImportPanel } from "./ImportPanel";
import type { PickedPlace } from "./PlaceSearch";
import { RouteThread } from "./RouteThread";
import { StopCard } from "./StopCard";
import { TripMapLazy } from "./TripMapLazy";
import { TripAlerts } from "./TripAlerts";
import { Button } from "./ui/Button";
import { FormError } from "./ui/Field";
import { Glyph } from "@/components/ui/Glyph";
import { describeDistance, summarizeDay, summarizeTrip } from "@/lib/trip-distance";
import { dayWithDate, isoDate, relativeDay, tripTiming } from "@/lib/time-context";
import { WhenChip } from "@/components/ui/WhenChip";
import { TripBuilder } from "@/components/builder/TripBuilder";
import type { PlanOption } from "@/lib/trip-builder";

type TripPlannerProps = {
  trip: Trip;
  places: PlaceWithSeason[];
  members: TripMember[];
  /** "YYYY-MM-DD", supplied by the server so server + client render identically. */
  today: string;
  siteUrl: string;
  /** Weather per place id (forecast or typical), fetched on the server. */
  conditions: Record<string, Conditions>;
  userId: string;
  votes: Record<string, VoteSummary>;
  /** Community updates per place id (nearest stop within ~1.5 km). */
  reports?: Record<string, ReportView[]>;
};

type PlanReport = { warnings: string[]; routing: "osrm" | "estimate"; daysUsed: number };

const monthName = (m: number) => new Date(2000, m - 1, 1).toLocaleString("en-IN", { month: "long" });

export function TripPlanner({ trip, places, today, conditions, userId, votes, reports = {} }: TripPlannerProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [activeDay, setActiveDay] = useState(1);
  const [showAddForm, setShowAddForm] = useState(false);
  const [importState, setImportState] = useState<{ open: boolean; brief?: string; nonce: number }>({ open: false, nonce: 0 });
  const [mapFit, setMapFit] = useState<"day" | "all">("all");
  // A plan option from the Trip builder being previewed on the map (nothing is saved until the traveller applies it).
  const [preview, setPreview] = useState<PlanOption | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<PlanReport | null>(null);
  const nowMinute = useNowMinute(); // 0 on the server, real time after hydration

  const refresh = () => startTransition(() => router.refresh());
  useTripRealtime(trip.id, userId, refresh, (name) => setNotice(`A group member just added “${name}”.`));

  const days = useMemo(() => Array.from({ length: trip.num_days }, (_, i) => i + 1), [trip.num_days]);

  // Everything the UI needs per stop: season status for ITS visit date, category, Go Score.
  const enriched = useMemo(
    () =>
      places.map((p) => {
        const month = visitMonth(trip.start_date, p.day_number, today);
        const status = getSeasonStatus(p.season_tags?.good_months, month);
        const category = normalizeCategory(p.category ?? p.season_tags?.category);
        const score: GoScore | null = computeGoScore({ category, seasonStatus: status, conditions: conditions[p.id] ?? null });
        return { place: p, status, category, score, month };
      }),
    [places, trip.start_date, today, conditions]
  );

  const dayItems = useMemo(() => enriched.filter((e) => e.place.day_number === activeDay), [enriched, activeDay]);
  // Ideas the group likes best float to the top.
  const ideas = useMemo(
    () =>
      enriched
        .filter((e) => e.place.day_number === null)
        .sort((a, b) => (votes[b.place.id]?.score ?? 0) - (votes[a.place.id]?.score ?? 0) || (a.place.sequence_order ?? 0) - (b.place.sequence_order ?? 0)),
    [enriched, votes]
  );
  const alerts = useMemo(
    () =>
      buildAlerts(
        dayItems
          .filter((e) => e.place.status !== "done" && e.place.status !== "skipped")
          .map((e) => ({ id: e.place.id, name: e.place.name, category: e.category, conditions: conditions[e.place.id] ?? null }))
      ),
    [dayItems, conditions]
  );
  const scored = useMemo(() => enriched.filter((e) => e.score), [enriched]);
  const attention = useMemo(
    () =>
      enriched
        .filter((e) => e.status === "wrong_season" || e.score?.tone === "poor")
        .sort((a, b) => (a.score?.score ?? 0) - (b.score?.score ?? 0))
        .slice(0, 5),
    [enriched]
  );
  const readiness = scored.length ? Math.round(scored.reduce((s, e) => s + e.score!.score, 0) / scored.length) : null;

  const stopCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const { place } of enriched) if (place.day_number) counts[place.day_number] = (counts[place.day_number] ?? 0) + 1;
    return counts;
  }, [enriched]);

  const mapPlaces = useMemo(() => {
    if (!preview) return places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, day: p.day_number, order: p.sequence_order }));
    // Preview: the option's days and order, on the same map. Places the plan leaves out show as unscheduled.
    const slot = new Map(preview.days.flatMap((d) => d.stops.map((s) => [s.placeId, { day: s.day, order: s.order }] as const)));
    return places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, day: slot.get(p.id)?.day ?? null, order: slot.get(p.id)?.order ?? null }));
  }, [places, preview]);
  const mapStart = useMemo(
    () => (trip.start_lat != null && trip.start_lng != null ? { lat: trip.start_lat, lng: trip.start_lng, label: trip.start_city ?? "Start" } : null),
    [trip.start_lat, trip.start_lng, trip.start_city]
  );
  const mapDest = useMemo(
    () => (trip.dest_lat != null && trip.dest_lng != null ? { lat: trip.dest_lat, lng: trip.dest_lng, label: trip.dest_name ?? "Destination" } : null),
    [trip.dest_lat, trip.dest_lng, trip.dest_name]
  );
  // Searches stay local to where the trip is GOING (falls back to the start city).
  const near = mapDest ?? mapStart;

  // Pins that are suspiciously far from the trip area (usually a wrong-state match).
  const farPins = useMemo(
    () => findFarPins(places.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng })), mapDest, undefined, mapStart ? [mapStart] : []),
    [places, mapDest, mapStart]
  );
  const farList = useMemo(
    () =>
      places
        .filter((p) => farPins[p.id])
        .sort((a, b) => farPins[b.id].km - farPins[a.id].km)
        .slice(0, 3),
    [places, farPins]
  );

  // Distance and driving time for the day and the whole trip — with the BASIS spelled out (road vs straight-line).
  const legOf = (p: { lat: number; lng: number; drive_km: number | null; drive_minutes: number | null }) => ({ lat: p.lat, lng: p.lng, drive_km: p.drive_km ?? null, drive_minutes: p.drive_minutes ?? null });
  const dayLegs = useMemo(() => {
    const byDay = new Map<number, ReturnType<typeof legOf>[]>();
    for (const p of [...places].filter((x) => x.day_number !== null).sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0) || (a.sequence_order ?? 0) - (b.sequence_order ?? 0))) {
      const list = byDay.get(p.day_number as number) ?? [];
      list.push(legOf(p));
      byDay.set(p.day_number as number, list);
    }
    return byDay;
  }, [places]);
  const startPoint = useMemo(() => (trip.start_lat != null && trip.start_lng != null ? { lat: trip.start_lat, lng: trip.start_lng } : null), [trip.start_lat, trip.start_lng]);
  const dayStats = useMemo(() => {
    const days = [...dayLegs.keys()].sort((a, b) => a - b);
    // Each day begins where the previous day ended (day 1: the trip's starting point).
    const prevDay = days.filter((d) => d < activeDay).pop();
    const from = prevDay !== undefined ? dayLegs.get(prevDay)!.at(-1) ?? null : activeDay === 1 ? startPoint : null;
    return summarizeDay(dayLegs.get(activeDay) ?? [], from);
  }, [dayLegs, activeDay, startPoint]);
  const tripStats = useMemo(() => summarizeTrip([...dayLegs.keys()].sort((a, b) => a - b).map((d) => dayLegs.get(d)!), startPoint), [dayLegs, startPoint]);
  const timing = useMemo(() => tripTiming(trip, today), [trip, today]);


  // Stable per render pass; "now" for report ages. (nowMinute is 0 until the browser clock is ready.)
  const reportNow = useMemo(() => new Date(nowMinute ? nowMinute * 60_000 : Date.parse(`${today}T12:00:00Z`)), [nowMinute, today]);

  const canAutoPlan = trip.start_lat != null && trip.start_lng != null && places.length > 0;
  const activeDate = dateOfTripDay(trip.start_date, activeDay);
  const activeISO = activeDate ? isoDate(activeDate) : null;

  async function call(url: string, init: RequestInit, failMsg: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(url, init);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? failMsg);
        return null;
      }
      return body ?? {};
    } catch {
      setError("Network problem — check your connection and try again.");
      return null;
    }
  }
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function removePlace(id: string) {
    setError(null);
    setBusyId(id);
    if (await call(`/api/places/${id}`, { method: "DELETE" }, "Couldn't remove this stop.")) refresh();
    setBusyId(null);
  }

  async function movePlace(id: string, day: number | null) {
    setError(null);
    setBusyId(id);
    if (await call(`/api/places/${id}`, json("PATCH", { day_number: day }), "Couldn't move this stop.")) {
      setNotice(day === null ? "Moved to Ideas." : `Moved to Day ${day}.`);
      refresh();
    }
    setBusyId(null);
  }

  async function votePlace(id: string, vote: -1 | 0 | 1) {
    setError(null);
    setBusyId(id);
    if (await call(`/api/places/${id}/vote`, json("POST", { vote }), "Couldn't save your vote.")) refresh();
    setBusyId(null);
  }

  async function setStatus(id: string, status: "planned" | "done" | "skipped") {
    setError(null);
    setBusyId(id);
    if (await call(`/api/places/${id}`, json("PATCH", { status }), "Couldn't update this stop.")) refresh();
    setBusyId(null);
  }

  async function relocatePlace(id: string, to: PickedPlace) {
    setError(null);
    setBusyId(id);
    if (await call(`/api/places/${id}`, json("PATCH", { lat: to.lat, lng: to.lng, address: to.address }), "Couldn't move the pin.")) {
      setNotice("Pin moved. Run Auto-plan again to refresh driving times.");
      refresh();
    }
    setBusyId(null);
  }

  function findAlternatives(place: Place) {
    const e = enriched.find((x) => x.place.id === place.id);
    const where = trip.dest_name || trip.start_city || "the trip area";
    const kind = CATEGORIES[e?.category ?? normalizeCategory(place.category)].label.toLowerCase();
    setImportState((s) => ({
      open: true,
      nonce: s.nonce + 1,
      brief: `Alternatives to ${place.name} (a ${kind}) that are good in ${e ? monthName(e.month) : "my travel month"}, near ${where}. Similar vibe, but better timing. Don't suggest ${place.name}.`,
    }));
    setShowAddForm(false);
  }

  async function autoPlan() {
    const ok = window.confirm(
      "Auto-plan will reorder ALL stops using real driving times, spread them across your days and set estimated arrival times. Continue?"
    );
    if (!ok) return;
    setError(null);
    setNotice(null);
    setPlanning(true);
    const body = await call(`/api/trips/${trip.id}/optimize`, { method: "POST" }, "Couldn't auto-plan this trip.");
    if (body) {
      setReport({ warnings: (body.warnings as string[]) ?? [], routing: body.routing as "osrm" | "estimate", daysUsed: Number(body.daysUsed) || 0 });
      setActiveDay(1);
      refresh();
    }
    setPlanning(false);
  }

  const cardProps = (e: (typeof enriched)[number]) => ({
    place: e.place,
    status: e.status,
    category: e.category,
    score: e.score,
    scoreFor: activeISO ? dayWithDate(activeISO, today) : undefined,
    seasonReason: e.place.season_tags?.reason,
    moveDays: days,
    votes: votes[e.place.id],
    farWarning: farPins[e.place.id],
    seasonSource: { confidence: e.place.season_tags?.confidence, urls: e.place.season_tags?.source_urls },
    near,
    onMove: movePlace,
    onRemove: removePlace,
    onVote: votePlace,
    onRelocate: relocatePlace,
    onAlternatives: findAlternatives,
    onStatus: setStatus,
    reports: reports[e.place.id],
    reportCtx: { userId, now: reportNow, onChanged: refresh },
    busy: busyId === e.place.id,
  });

  return (
    <div className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm text-ink-muted">Build the itinerary. Planning lives here; travelling happens on the <strong className="text-pine">Live</strong> page.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => { setImportState((s) => ({ open: true, nonce: s.nonce + 1 })); setShowAddForm(false); }}><span className="inline-flex items-center gap-1.5"><Glyph name="sparkles" size={16} />Import places</span></Button>
          <Button onClick={autoPlan} disabled={!canAutoPlan || planning || isRefreshing}>{planning ? "Planning route…" : <span className="inline-flex items-center gap-1.5"><Glyph name="navigate" size={16} />Auto-plan route</span>}</Button>
        </div>
        {!canAutoPlan && <p className="text-sm text-ink-muted sm:basis-full">{places.length === 0 ? "Add a few places to enable auto-planning." : "This trip has no start point set."}</p>}
      </div>

      <main id="main" className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start">
        {/* ───── Map ───── */}
        <div className="relative h-80 overflow-hidden rounded-2xl border border-line bg-white shadow-sm lg:col-start-2 lg:row-start-1 lg:h-96">
          {preview && (
            <p role="status" className="absolute inset-x-2 bottom-2 z-10 flex items-center justify-between gap-2 rounded-xl bg-pine/95 px-3 py-2 text-xs font-semibold text-white shadow">
              <span>Previewing the {preview.label} plan — not saved yet</span>
              <button type="button" onClick={() => setPreview(null)} className="min-h-8 underline underline-offset-2">Back to my plan</button>
            </p>
          )}
          <TripMapLazy
            places={mapPlaces}
            start={mapStart}
            destination={mapDest}
            activeDay={activeDay}
            fit={mapFit}
          />
          <div role="group" aria-label="Map framing" className="absolute left-2 top-2 flex overflow-hidden rounded-lg border border-line bg-white text-xs font-semibold shadow">
            {(["day", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={mapFit === f}
                onClick={() => setMapFit(f)}
                className={`min-h-9 px-3 ${mapFit === f ? "bg-pine text-white" : "text-ink-muted hover:bg-sky"}`}
              >
                {f === "day" ? `Day ${activeDay}` : "Whole trip"}
              </button>
            ))}
          </div>
        </div>

        {/* ───── Itinerary + ideas ───── */}
        <div className="space-y-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <TripBuilder
            tripId={trip.id}
            places={places}
            hasStart={trip.start_lat != null && trip.start_lng != null}
            hasDestination={trip.dest_lat != null && trip.dest_lng != null}
            onPreview={(o) => { setPreview(o); if (o) setMapFit("all"); }}
            onChanged={refresh}
          />
          {importState.open && (
            <ImportPanel
              key={importState.nonce}
              tripId={trip.id}
              startDate={trip.start_date}
              today={today}
              initialBrief={importState.brief}
              onCancel={() => setImportState((s) => ({ ...s, open: false }))}
              onDone={(n) => {
                setImportState((s) => ({ ...s, open: false }));
                setNotice(`Added ${n} ${n === 1 ? "place" : "places"} to your Ideas. Vote on them, then let Auto-plan schedule them.`);
                refresh();
              }}
            />
          )}

          <div aria-live="polite" className="space-y-3 empty:hidden">
            <FormError message={error} />
            {notice && <p role="status" className="rounded-xl border border-teal/30 bg-teal-light px-4 py-3 text-sm font-medium text-teal-ink">{notice}</p>}
            {report && (
              <div role="status" className="rounded-xl border border-line bg-white px-4 py-3 text-sm">
                <p className="font-semibold text-pine">
                  Planned across {report.daysUsed} {report.daysUsed === 1 ? "day" : "days"} using{" "}
                  {report.routing === "osrm" ? "real driving times" : "estimated driving times"}.
                </p>
                {report.warnings.length > 0 && (
                  <ul className="mt-2 space-y-1 text-clay-ink">
                    {report.warnings.map((w) => <li key={w} className="flex items-start gap-1.5"><Glyph name="warn" size={14} className="mt-0.5" />{w}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-sm shadow-pine/5">
            <RouteThread
              numDays={trip.num_days}
              activeDay={activeDay}
              onSelectDay={(d) => { setActiveDay(d); setShowAddForm(false); }}
              startDate={trip.start_date}
              stopCounts={stopCounts}
            />

            <section aria-labelledby="day-heading" className="px-4 pb-6 pt-5 sm:px-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id="day-heading" className="font-display text-xl font-semibold text-pine">
                  Day {activeDay}
                  {activeDate && (
                    <span className="ml-2 text-base font-normal text-ink-muted">
                      {formatDate(activeDate, { weekday: "long", day: "numeric", month: "long" })}
                    </span>
                  )}
                  {activeISO && ["Today", "Tomorrow", "Yesterday"].includes(relativeDay(activeISO, today)) && (
                    <span className="ml-2 align-middle"><WhenChip kind="planned" detail={relativeDay(activeISO, today)} /></span>
                  )}
                </h2>
                <span className="font-mono text-xs text-ink-muted">
                  {dayItems.length} STOP{dayItems.length !== 1 ? "S" : ""}
                  {dayStats.basis !== "none" ? ` · ${describeDistance(dayStats).toUpperCase()}` : ""}
                  {dayStats.minutes !== null ? ` · ${formatDuration(dayStats.minutes).toUpperCase()} DRIVING` : ""}
                </span>
              </div>

              {timing.state === "before" && (
                <p role="note" className="mt-3 flex items-start gap-2 rounded-xl bg-sky px-3 py-2 text-sm text-ink-muted">
                  <Glyph name="info" size={16} className="mt-0.5 shrink-0 text-pine" />
                  <span><strong className="text-pine">{timing.headline}</strong> Go scores and weather on this page are for your trip days, not for today.</span>
                </p>
              )}
              {timing.state === "after" && (
                <p role="note" className="mt-3 flex items-start gap-2 rounded-xl bg-sky px-3 py-2 text-sm text-ink-muted">
                  <Glyph name="info" size={16} className="mt-0.5 shrink-0 text-pine" /><span>{timing.headline}</span>
                </p>
              )}

              <TripAlerts alerts={alerts} />

              {dayItems.length === 0 ? (
                <p className="py-10 text-center text-base text-ink-muted">
                  Nothing on Day {activeDay} yet. {ideas.length > 0 ? "Schedule something from your Ideas below, or run Auto-plan." : "Import places or add one below."}
                </p>
              ) : (
                <ol className="mt-2">
                  {dayItems.map((e) => <StopCard key={e.place.id} {...cardProps(e)} />)}
                </ol>
              )}

              <div className="mt-4">
                {showAddForm ? (
                  <AddPlaceForm
                    tripId={trip.id}
                    dayNumber={activeDay}
                    near={near}
                    onCancel={() => setShowAddForm(false)}
                    onAdded={() => { setShowAddForm(false); refresh(); }}
                  />
                ) : (
                  <Button variant="secondary" onClick={() => setShowAddForm(true)} className="w-full sm:w-auto">
                    + Add a stop to Day {activeDay}
                  </Button>
                )}
              </div>
            </section>
          </div>

          {/* Ideas pool: places collected but not on a day yet */}
          <section aria-labelledby="ideas-heading" className="rounded-3xl border border-dashed border-teal/40 bg-white/70 px-4 pb-4 pt-5 sm:px-6">
            <h2 id="ideas-heading" className="font-display text-xl font-semibold text-pine">
              <Glyph name="idea" size={18} className="mr-1.5 inline align-text-bottom text-marigold" />Ideas <span className="font-mono text-sm font-normal text-ink-muted">({ideas.length})</span>
            </h2>
            {ideas.length === 0 ? (
              <p className="py-4 text-base text-ink-muted">
                Places you import land here first, so the group can vote before anything is scheduled. Paste a Maps link, a caption or a screenshot with <strong>Import places</strong>.
              </p>
            ) : (
              <ul className="mt-1">
                {ideas.map((e) => <StopCard key={e.place.id} {...cardProps(e)} />)}
              </ul>
            )}
          </section>
        </div>

        {/* ───── Sidebar ───── */}
        <aside className="space-y-6 lg:col-start-2 lg:row-start-2" aria-label="Trip overview">
          <section aria-labelledby="overview-heading" className="rounded-2xl border border-line bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 id="overview-heading" className="font-display text-lg font-semibold text-pine">Trip readiness</h2>
              {readiness !== null && (
                <span className="font-mono text-2xl font-semibold text-pine">{readiness}<span className="text-sm text-ink-muted">/100</span></span>
              )}
            </div>

            {places.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">Add places and Trailmate scores each one for the day you&apos;ll be there — season, weather and more.</p>
            ) : scored.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">We don&apos;t have season or weather data for these places yet, so we can&apos;t judge their timing.</p>
            ) : attention.length === 0 ? (
              <p className="mt-2 text-sm text-teal-ink">
                <Glyph name="check" size={15} className="mr-1.5 inline align-text-bottom" />Timing looks good for {scored.length === places.length ? "all" : `the ${scored.length} places we have data for`}
                {scored.length === places.length && ` ${places.length} ${places.length === 1 ? "stop" : "stops"}`}.
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-clay-ink">
                  <Glyph name="warn" size={15} className="mr-1.5 inline align-text-bottom" />
                  {attention.length} {attention.length === 1 ? "stop needs" : "stops need"} a second look:
                </p>
                <ul className="mt-3 space-y-2">
                  {attention.map(({ place, score }) => (
                    <li key={place.id}>
                      <button
                        type="button"
                        onClick={() => place.day_number && setActiveDay(place.day_number)}
                        disabled={!place.day_number}
                        className="w-full rounded-xl bg-clay-light px-3 py-2.5 text-left text-sm hover:bg-[#f7d9cc] disabled:cursor-default"
                      >
                        <span className="font-semibold text-clay-ink">{place.name}</span>
                        <span className="block text-ink-muted">
                          {score ? `Go score ${score.score} · ${score.reasons[score.reasons.length - 1]}` : "Outside its best season"}
                          {place.day_number ? ` — Day ${place.day_number}` : " — in Ideas"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {tripStats.basis !== "none" && (
                <p className="mt-3 border-t border-line pt-3 text-sm text-ink-muted">
                  <strong className="text-pine">Whole trip:</strong> {describeDistance(tripStats)}
                  {tripStats.minutes !== null ? ` · ${formatDuration(tripStats.minutes)} driving` : ""}
                  {tripStats.basis !== "road" && <span className="mt-1 block text-xs">Run <strong>Auto-plan route</strong> to get distances and times by road.</span>}
                </p>
              )}
            </section>

          {farList.length > 0 && (
            <section aria-labelledby="pins-heading" className="rounded-2xl border border-clay/30 bg-clay-light/60 p-5">
              <h2 id="pins-heading" className="font-display text-lg font-semibold text-clay-ink">Pins to double-check</h2>
              <p className="mt-1 text-sm text-ink-muted">These look far from {mapDest ? mapDest.label : "your other stops"}. Open the stop and use “Wrong location?” if one is wrong.</p>
              <ul className="mt-3 space-y-2">
                {farList.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => p.day_number && setActiveDay(p.day_number)}
                      disabled={!p.day_number}
                      className="w-full rounded-xl bg-white px-3 py-2.5 text-left text-sm hover:bg-sky disabled:cursor-default"
                    >
                      <span className="font-semibold">{p.name}</span>
                      <span className="block text-ink-muted">
                        {Math.round(farPins[p.id].km)} km away{p.day_number ? ` — Day ${p.day_number}` : " — in Ideas"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="px-1 text-xs leading-relaxed text-ink-muted">
            Go scores are estimates from season data plus a weather forecast (next 16 days) or typical conditions for your dates
            (last 6 years). Driving times come from a routing service and may differ from your real trip. Pins come from a public
            map search — if one looks wrong, use “Wrong location?” on the stop.
          </p>
        </aside>
      </main>
    </div>
  );
}
