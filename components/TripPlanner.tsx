"use client";

import { dbTime12 } from "@/lib/travel/clock";
import { parseISODate } from "@/lib/dates";
import { PlanHeader, type PlanTool } from "@/components/PlanHeader";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { useNowMinute } from "@/lib/client/use-now";
import { usePlacePhotos } from "@/lib/client/use-place-photos";
import { useTripChanges } from "@/lib/client/use-trip-changes";
import { useOutbox } from "@/lib/client/use-outbox";
import { OFFLINE_SAVED_TEXT, applyOutboxToPlaces, applyOutboxToVotes } from "@/lib/client/outbox";
import { OutboxStatus } from "./OutboxStatus";
import { announceStopsChanged } from "@/lib/client/stop-signal";
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
import { TripDatesPanel } from "./TripDatesPanel";
import { TripCheck } from "./TripCheck";
import Link from "next/link";
import { useWeatherBoard } from "@/lib/client/use-weather-board";
import type { BoardStop } from "@/lib/forecast/board";
import { tripDayISO } from "@/lib/forecast/ist";
import { DEFAULT_VIEW, plannedInstant, typicalView } from "@/lib/forecast/view-time";
import { SEVERITY_RANK } from "@/lib/weather-rules";
import { StopWeatherLine, WeatherAlertRow } from "@/components/weather/WeatherParts";
import { usePlanRoad } from "@/lib/client/use-plan-road";
import { planLine } from "@/lib/map/plan-line";
import { FormError } from "./ui/Field";
import { Glyph } from "@/components/ui/Glyph";
import { describeDistance, summarizeDay, summarizeTrip } from "@/lib/trip-distance";
import { dayWithDate, isoDate, relativeDay, tripTiming } from "@/lib/time-context";
import { WhenChip } from "@/components/ui/WhenChip";
import { TripBuilder } from "@/components/builder/TripBuilder";
import { builderEndMode } from "@/lib/trip/end";
import { GroupPanel } from "@/components/plan/GroupPanel";
import { NO_OVERRIDES, applyPlaceOverrides, applyVoteOverrides, dropOverride, withPlaceOverride, withVoteOverride, type Overrides } from "@/lib/optimistic";
import { duration, hhmm, type PlanOption } from "@/lib/trip-builder";

type TripPlannerProps = {
  trip: Trip;
  places: PlaceWithSeason[];
  members?: TripMember[];
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

const monthName = (m: number) => new Date(2000, m - 1, 1).toLocaleString("en-IN", { month: "long" });

export function TripPlanner({ trip, places: serverPlaces, members = [], today, conditions, userId, votes: serverVotes, reports = {} }: TripPlannerProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeDay, setActiveDay] = useState(1);
  const [showAddForm, setShowAddForm] = useState(false);
  // One tool panel open at a time (plan, when to leave, dates). Import has its own state because "Find alternatives" opens it with a brief.
  const [tool, setTool] = useState<Exclude<PlanTool, "import"> | null>(null);
  // "?tool=dates" (from "No trip date set" on the trip's Weather page) opens the date picker; "?tool=plan" (right after the guided
  // flow created the trip) opens "Plan my trip"; "?tool=group" opens "Ask your group".
  useEffect(() => {
    let wanted: string | null = null;
    try { wanted = new URLSearchParams(window.location.search).get("tool"); } catch { /* no URL */ }
    if (wanted !== "dates" && wanted !== "plan" && wanted !== "group") return;
    const t = window.setTimeout(() => setTool(wanted as "dates" | "plan" | "group"), 0); // after the first paint, like the page's other browser-only state
    return () => window.clearTimeout(t);
  }, []);
  const toolRef = useRef<HTMLDivElement>(null);
  const [importState, setImportState] = useState<{ open: boolean; brief?: string; nonce: number }>({ open: false, nonce: 0 });
  const [mapFit, setMapFit] = useState<"day" | "all">("all");
  // A plan option from the Plan my trip assistant being previewed on the map (nothing is saved until the traveller applies it).
  const [preview, setPreview] = useState<PlanOption | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // A confirmation that appears far from where the traveller is looking is a silent one: bring it into view.
  useEffect(() => { if (notice) { noticeRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" }); } }, [notice]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const nowMinute = useNowMinute(); // 0 on the server, real time after hydration

  // Done / skip / undo, votes and remove show their result the instant you tap (the card says "Saving…" until the server confirms;
  // a failed save is taken back and the error shown). Fresh server data always replaces these local changes. See lib/optimistic.ts.
  const [ov, setOv] = useState<Overrides>(NO_OVERRIDES);
  const refresh = () => startTransition(() => router.refresh());
  // Votes, done/skip, moves and pin fixes made with no signal: kept on this phone for THIS person, shown at once, sent when online.
  const outbox = useOutbox(trip.id, userId, refresh);
  const offlinePlaces = useMemo(() => applyOutboxToPlaces(serverPlaces, outbox.items), [serverPlaces, outbox.items]);
  const offlineVotes = useMemo(() => applyOutboxToVotes(serverVotes, outbox.items), [serverVotes, outbox.items]);
  const places = useMemo(() => applyPlaceOverrides(offlinePlaces, ov, serverPlaces), [offlinePlaces, ov, serverPlaces]);
  const votes = useMemo(() => applyVoteOverrides(offlineVotes, ov, serverVotes), [offlineVotes, ov, serverVotes]);

  useTripRealtime(trip.id, userId, refresh, (name) => setNotice(`A group member just added “${name}”.`));
  // Inserts and edits arrive through useTripRealtime; this adds what Realtime cannot filter by trip: stops DELETED elsewhere.
  useTripChanges({ tripId: trip.id, places: serverPlaces, driving: false, onChange: refresh, listenToRows: false });

  const days = useMemo(() => Array.from({ length: trip.num_days }, (_, i) => i + 1), [trip.num_days]);

  // Everything the UI needs per stop: season status for ITS visit date, category, Go Score.
  // Real photos of the stops, filled in after the plan is on screen. Stops without a confident match keep their icon.
  const photoQueries = useMemo(() => places.map((p) => ({ key: p.id, name: p.name, lat: p.lat, lng: p.lng })), [places]);
  const photos = usePlacePhotos(photoQueries);

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
  // ── Weather at each scheduled stop for the time it is planned (lib/forecast), refreshed by itself. ──
  const wxNow = nowMinute ? nowMinute * 60_000 : 0;
  const wxStops = useMemo<BoardStop[]>(() => places
    .filter((p) => p.day_number !== null && (p.status ?? "planned") === "planned")
    .map((p) => {
      const dayISO = tripDayISO(trip.start_date, p.day_number);
      return { id: p.id, name: p.name, lat: p.lat, lng: p.lng, isNext: false, liveEta: null, planned: plannedInstant(dayISO, p.arrival_time ?? null), dayISO, typical: typicalView(conditions[p.id]) };
    }), [places, trip.start_date, conditions]);
  const wx = useWeatherBoard({ enabled: wxNow > 0 && wxStops.length > 0, nowMs: wxNow, mode: DEFAULT_VIEW, here: null, stops: wxStops, road: [] });
  const wxPlaces = useMemo(() => new Map(wx.places.map((p) => [p.id, p])), [wx.places]);
  const wxAlertsFor = (id: string) => wx.alerts.filter((a) => a.placeId === id);
  const dayWeatherAlerts = wx.alerts.filter((a) => SEVERITY_RANK[a.level] >= SEVERITY_RANK.warning && dayItems.some((e) => e.place.id === a.placeId));

  // Day-level heads-ups only for stops with no forecast at their arrival hour (no planned time yet): never "Hot", plain numbers.
  const alerts = useMemo(
    () =>
      buildAlerts(
        dayItems
          .filter((e) => e.place.status !== "done" && e.place.status !== "skipped" && wxPlaces.get(e.place.id)?.moment?.status !== "ok")
          .map((e) => ({ id: e.place.id, name: e.place.name, category: e.category, conditions: conditions[e.place.id] ?? null }))
      ),
    [dayItems, conditions, wxPlaces]
  );
  const attention = useMemo(
    () =>
      enriched
        .filter((e) => e.status === "wrong_season" || e.score?.tone === "poor")
        .sort((a, b) => (a.score?.score ?? 0) - (b.score?.score ?? 0))
        .slice(0, 5),
    [enriched]
  );

  const stopCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const { place } of enriched) if (place.day_number) counts[place.day_number] = (counts[place.day_number] ?? 0) + 1;
    return counts;
  }, [enriched]);

  const mapPlaces = useMemo(() => {
    const drive = (p: (typeof places)[number]) => (p.drive_minutes ? `${formatDuration(p.drive_minutes)}${p.drive_km != null ? ` · ${Math.round(p.drive_km)} km` : ""} from the previous point` : null);
    if (!preview) return places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, day: p.day_number, order: p.sequence_order, status: p.status ?? null, arrival: dbTime12(p.arrival_time), driveText: drive(p) }));
    // Preview: the option's days and order, on the same map. Places the plan leaves out show as unscheduled.
    const slot = new Map(preview.days.flatMap((d) => d.stops.map((s) => [s.placeId, { day: s.day, order: s.order, arrive: hhmm(s.arriveMin), drive: `${duration(s.driveMin)} · ${Math.round(s.driveKm)} km from the previous point` }] as const)));
    return places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, day: slot.get(p.id)?.day ?? null, order: slot.get(p.id)?.order ?? null, status: p.status ?? null, arrival: slot.get(p.id)?.arrive ?? null, driveText: slot.get(p.id)?.drive ?? null }));
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

  // The real road for the day being looked at (the same points as the dashed plan line). Loads in the background.
  const roadPoints = useMemo(() => planLine({ places: mapPlaces, start: mapStart, destination: mapDest, activeDay, numDays: trip.num_days }).map(([lng, lat]) => ({ lat, lng })), [mapPlaces, mapStart, mapDest, activeDay, trip.num_days]);
  const road = usePlanRoad(roadPoints);

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

  // The header: which trip, when, how big, and one line about driving.
  const shortDay = (iso: string) => formatDate(parseISODate(iso) ?? new Date(), { weekday: "short", day: "numeric", month: "short" });
  const headerDates = timing.firstDate && timing.lastDate ? `${shortDay(timing.firstDate)} to ${shortDay(timing.lastDate)}` : "No dates yet";
  const headerMeta = `${trip.num_days} ${trip.num_days === 1 ? "day" : "days"} · ${places.length} ${places.length === 1 ? "place" : "places"}`;
  const headerStatus = tripStats.basis === "none" ? null : `${describeDistance(tripStats)}${tripStats.minutes !== null ? ` · ${formatDuration(tripStats.minutes)} driving` : ""}`;

  // What deserves a second look, in one short list: stops whose timing is poor, and pins that look far from the rest.
  const worthALook = useMemo(() => {
    const out: { key: string; title: string; detail: string; day: number | null }[] = [];
    for (const { place, score } of attention) out.push({ key: `t-${place.id}`, title: place.name, detail: `${score ? score.reasons[score.reasons.length - 1] : "Outside its best season"}${place.day_number ? ` · Day ${place.day_number}` : " · in Ideas"}`, day: place.day_number });
    for (const p of farList) out.push({ key: `p-${p.id}`, title: `Check the pin for ${p.name}`, detail: `${Math.round(farPins[p.id].km)} km from ${mapDest ? mapDest.label : "your other stops"}. Use “Wrong location?” on the stop if it's wrong.`, day: p.day_number });
    return out;
  }, [attention, farList, farPins, mapDest]);


  // Stable per render pass; "now" for report ages. (nowMinute is 0 until the browser clock is ready.)
  const reportNow = useMemo(() => new Date(nowMinute ? nowMinute * 60_000 : Date.parse(`${today}T12:00:00Z`)), [nowMinute, today]);

  const activeDate = dateOfTripDay(trip.start_date, activeDay);
  const activeISO = activeDate ? isoDate(activeDate) : null;

  async function call(url: string, init: RequestInit, failMsg: string): Promise<Record<string, unknown> | null> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError("This needs a connection. Nothing was changed — try again when you're back online.");
      return null;
    }
    try {
      const res = await fetch(url, init);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? failMsg);
        return null;
      }
      // Tell the trip's other open screens (Live, Map, other members) — deletes especially cannot reach them any other way.
      if (init.method && init.method !== "GET") void announceStopsChanged(trip.id);
      return body ?? {};
    } catch {
      setError("Network problem — check your connection and try again.");
      return null;
    }
  }

  async function removePlace(id: string) {
    setError(null);
    // Deleting can't be undone and others may have changed the trip meanwhile, so it is never queued.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return setError("Deleting a stop needs a connection. Nothing was deleted — try again when you're back online.");
    setBusyId(id);
    setOv((cur) => withPlaceOverride(cur, serverPlaces, serverVotes, id, { removed: true }));
    if (await call(`/api/places/${id}`, { method: "DELETE" }, "Couldn't remove this stop.")) refresh();
    else setOv((cur) => dropOverride(cur, id)); // it did not work: the stop comes back
    setBusyId(null);
  }

  const nameOf = (id: string) => serverPlaces.find((p) => p.id === id)?.name;

  async function movePlace(id: string, day: number | null) {
    setError(null);
    setBusyId(id);
    const r = await outbox.send({ kind: "move", placeId: id, day }, nameOf(id));
    if (r === "saved") setNotice(day === null ? "Moved to Ideas." : `Moved to Day ${day}.`);
    if (r === "queued") setNotice(OFFLINE_SAVED_TEXT);
    setBusyId(null);
  }

  async function votePlace(id: string, vote: -1 | 0 | 1) {
    setError(null);
    setBusyId(id);
    setOv((cur) => withVoteOverride(cur, serverPlaces, serverVotes, id, vote));
    const r = await outbox.send({ kind: "vote", placeId: id, vote }, nameOf(id));
    if (r !== "saved") setOv((cur) => dropOverride(cur, id)); // queued: the outbox now shows it; refused: your vote goes back
    if (r === "queued") setNotice(OFFLINE_SAVED_TEXT);
    setBusyId(null);
  }

  async function setStatus(id: string, status: "planned" | "done" | "skipped") {
    setError(null);
    setBusyId(id);
    setOv((cur) => withPlaceOverride(cur, serverPlaces, serverVotes, id, { status }));
    const r = await outbox.send({ kind: "status", placeId: id, status }, nameOf(id));
    if (r !== "saved") setOv((cur) => dropOverride(cur, id)); // queued: the outbox now shows it; refused: the stop goes back
    if (r === "queued") setNotice(OFFLINE_SAVED_TEXT);
    setBusyId(null);
  }

  async function relocatePlace(id: string, to: PickedPlace) {
    setError(null);
    setBusyId(id);
    const r = await outbox.send({ kind: "relocate", placeId: id, lat: to.lat, lng: to.lng, address: to.address ?? null }, nameOf(id));
    if (r === "saved") setNotice("Pin moved. Use Plan my trip again to refresh driving times.");
    if (r === "queued") setNotice(`${OFFLINE_SAVED_TEXT} Use Plan my trip again afterwards to refresh driving times.`);
    setBusyId(null);
  }

  /** Open one tool at a time; tapping the open one closes it. */
  function openTool(t: PlanTool) {
    setShowAddForm(false);
    if (t === "import") { setTool(null); setPreview(null); setImportState((st) => ({ open: !st.open, nonce: st.nonce + 1 })); return; }
    setImportState((st) => ({ ...st, open: false }));
    if (t !== "plan") setPreview(null);
    setTool((cur) => (cur === t ? null : t));
  }
  useEffect(() => { if (tool) toolRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }, [tool]);

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

  /** "Show on the map" on a stop card: highlight it, open its details on the map, and on a phone bring the map into view. */
  function showOnMap(id: string) {
    setSelectedId(id);
    const day = places.find((x) => x.id === id)?.day_number;
    if (day) setActiveDay(day);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) document.getElementById("plan-map")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  /** A pin was tapped on the map: show that day, highlight the stop and scroll to its card. */
  function selectFromMap(id: string) {
    setSelectedId(id);
    const day = places.find((x) => x.id === id)?.day_number;
    if (day) setActiveDay(day);
    requestAnimationFrame(() => document.getElementById(`stop-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  const cardProps = (e: (typeof enriched)[number]) => ({
    place: e.place,
    photo: photos[e.place.id] ?? null,
    status: e.status,
    category: e.category,
    score: e.score,
    scoreFor: activeISO ? dayWithDate(activeISO, today) : "today (no trip dates set)",
    seasonReason: e.place.season_tags?.reason,
    moveDays: days,
    votes: votes[e.place.id],
    farWarning: farPins[e.place.id],
    seasonSource: { confidence: e.place.season_tags?.confidence, urls: e.place.season_tags?.source_urls },
    near,
    onMove: movePlace,
    onRemove: removePlace,
    onVote: members.length > 1 ? votePlace : undefined, // a vote means nothing on a solo trip
    onRelocate: relocatePlace,
    onAlternatives: findAlternatives,
    onStatus: setStatus,
    reports: reports[e.place.id],
    reportCtx: { userId, now: reportNow, onChanged: refresh, outbox },
    busy: busyId === e.place.id,
    selected: selectedId === e.place.id,
    weather: e.place.day_number !== null && (e.place.status ?? "planned") === "planned"
      ? <StopWeatherLine place={wxPlaces.get(e.place.id)} alerts={wxAlertsFor(e.place.id)} nowMs={wxNow} onSetDates={() => setTool("dates")} />
      : null,
    onShowOnMap: showOnMap,
  });

  return (
    <div className="flex-1">
      <PlanHeader
        dates={headerDates}
        meta={headerMeta}
        status={headerStatus}
        countdown={timing.state === "before" ? timing.headline : timing.state === "during" ? timing.headline : timing.state === "after" ? timing.headline : null}
        active={importState.open ? "import" : tool}
        hasDates={!!trip.start_date}
        onTool={openTool}
      />

      <div className="mx-auto w-full max-w-7xl space-y-4 px-4 pt-4 empty:hidden sm:px-6 lg:[&>*]:max-w-3xl">
        <div ref={toolRef} id="tool-panel" className="scroll-mt-4 space-y-4 empty:hidden">
          {tool === "dates" && (
            <TripDatesPanel
              tripId={trip.id}
              startDate={trip.start_date}
              numDays={trip.num_days}
              canEdit={trip.owner_id === userId}
              stopCountsByDay={stopCounts}
              onChanged={() => { setTool(null); refresh(); }}
            />
          )}
          {tool === "leave" && (
            <TripCheck tripId={trip.id} trip={trip} places={places} activeDay={activeDay} today={today} roadLine={road.line} onClose={() => setTool(null)} onSetDates={() => setTool("dates")} onPlanTrip={() => setTool("plan")} />
          )}
          {tool === "group" && <GroupPanel tripId={trip.id} onClose={() => setTool(null)} />}
          {tool === "plan" && (
            <TripBuilder
              tripId={trip.id}
              places={places}
              hasStart={trip.start_lat != null && trip.start_lng != null}
              hasDestination={trip.dest_lat != null && trip.dest_lng != null}
              startLabel={trip.start_city}
              destLabel={trip.dest_name}
              defaultEndMode={builderEndMode(trip)}
              canEditTrip={trip.owner_id === userId}
              hasDates={!!trip.start_date}
              onClose={() => { setTool(null); setPreview(null); }}
              onPreview={(o) => { setPreview(o); if (o) setMapFit("all"); }}
              onChanged={refresh}
            />
          )}
        </div>

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
              setNotice(`Added ${n} ${n === 1 ? "place" : "places"} to your Ideas. Use Plan my trip to schedule them.`);
              refresh();
            }}
          />
        )}
        <div aria-live="polite" className="space-y-3 empty:hidden">
          <FormError message={error} />
          <OutboxStatus outbox={outbox} />
          {notice && <p ref={noticeRef} id="plan-notice" tabIndex={-1} role="status" className="scroll-mt-24 rounded-xl border border-teal/30 bg-teal-light px-4 py-3 text-sm font-medium text-teal-ink outline-none">{notice}</p>}
        </div>
      </div>

      <main id="main" className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start">
        {/* ───── Map (stays in view on a laptop while you read the days) + trip overview ───── */}
        <div className="space-y-6 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-stretch">
        <div id="plan-map" className="relative h-56 scroll-mt-4 overflow-hidden rounded-2xl border border-line bg-white shadow-sm sm:h-72 lg:sticky lg:top-4 lg:z-20 lg:h-[26rem]">
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
            numDays={trip.num_days}
            selectedId={selectedId}
            onSelectPlace={selectFromMap}
            planRoad={road.line}
          />
          {roadPoints.length >= 2 && (
            <p role="status" className="pointer-events-none absolute left-2 top-14 z-10 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-ink-muted shadow">
              <Glyph name="car" size={13} />
              {road.line ? "Road route for this day" : road.loading ? "Finding the road…" : "Straight lines (road route not available)"}
            </p>
          )}
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
        </div>

        {/* ───── Itinerary + ideas ───── */}
        <div className="space-y-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {worthALook.length > 0 && (
            <section aria-labelledby="look-heading" className="rounded-2xl border border-marigold/40 bg-marigold-light/40 p-3.5">
              <h2 id="look-heading" className="flex items-center gap-2 text-sm font-semibold text-pine"><Glyph name="warn" size={15} />Worth a look ({worthALook.length})</h2>
              <ul className="mt-2 space-y-1.5">
                {worthALook.slice(0, 3).map((w) => <li key={w.key}><button type="button" onClick={() => w.day && setActiveDay(w.day)} disabled={!w.day} className="w-full rounded-xl bg-white/80 px-3 py-2 text-left text-sm hover:bg-white disabled:cursor-default"><span className="font-semibold text-pine">{w.title}</span><span className="block text-ink-muted">{w.detail}</span></button></li>)}
              </ul>
              {worthALook.length > 3 && (
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-teal-ink underline underline-offset-2">{worthALook.length - 3} more</summary>
                  <ul className="space-y-1.5 pb-1">
                    {worthALook.slice(3).map((w) => <li key={w.key}><button type="button" onClick={() => w.day && setActiveDay(w.day)} disabled={!w.day} className="w-full rounded-xl bg-white/80 px-3 py-2 text-left text-sm hover:bg-white disabled:cursor-default"><span className="font-semibold text-pine">{w.title}</span><span className="block text-ink-muted">{w.detail}</span></button></li>)}
                  </ul>
                </details>
              )}
            </section>
          )}


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

              <TripAlerts alerts={alerts} />
              {dayWeatherAlerts.length > 0 && (
                <section aria-label="Weather alerts for this day" className="mt-2">
                  <ul className="space-y-1.5">{dayWeatherAlerts.map((a) => <WeatherAlertRow key={a.id} a={a} />)}</ul>
                </section>
              )}
              {wxStops.length > 0 && <Link href={`/trips/${trip.id}/weather`} className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-teal-ink">Weather for every stop<Glyph name="arrow" size={14} /></Link>}

              {dayItems.length === 0 ? (
                <p className="py-10 text-center text-base text-ink-muted">
                  Nothing on Day {activeDay} yet. {ideas.length > 0 ? "Schedule something from your Ideas below, or use Plan my trip." : "Import places or add one below."}
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
                Imported places wait here until you schedule them. Add some with <strong>Import places</strong>: a Maps link, a caption or a screenshot.
              </p>
            ) : (
              <ul className="mt-1">
                {ideas.map((e) => <StopCard key={e.place.id} {...cardProps(e)} />)}
              </ul>
            )}
          </section>
        </div>

      </main>
    </div>
  );
}
