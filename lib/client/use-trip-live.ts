"use client";

import type { Vehicle } from "@/lib/vehicle";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import { useDrive, type Drive, type DriveTarget, type Me } from "@/lib/client/use-drive";
import { speak, useNavigation, type Navigation } from "@/lib/client/use-navigation";
import { useStopRemoved } from "@/lib/client/use-stop-removed";
import { kmText, remainingDistance } from "@/lib/trip/remaining";
import { useIntel, type IntelState, type IntelStopInput } from "@/lib/client/use-intel";
import { useNowMinute } from "@/lib/client/use-now";
import type { Enriched } from "@/lib/client/enrich";
import { safeColor } from "@/lib/format";
import { checkStart } from "@/lib/location/start-check";
import { journeySummary } from "@/lib/map/journey";
import { DESTINATION_ID, planDriveTargets, type PlanTarget } from "@/lib/map/drive-targets";
import { tripTiming } from "@/lib/time-context";
import { liveDayFor } from "@/lib/trip-state";
import { isClosed, isResumed, resumedDay } from "@/lib/trip/lifecycle";
import type { PlaceWithSeason, Trip, TripMember } from "@/lib/types";
import type { VoteSummary } from "@/lib/votes";
import type { LiveMarker, PoiMarker } from "@/components/TripMap";

type Args = {
  trip: Trip;
  places: PlaceWithSeason[];
  members: TripMember[];
  userId: string;
  enriched: Enriched[];
  votes: Record<string, VoteSummary>;
  /** Which day the person is looking at (used before the trip starts). */
  focusDay: number;
  /** Show every place ahead on the map (default: only the radar's best picks, to keep the map readable). */
  showAllPlaces?: boolean;
  /** What the traveller is driving (default: car). */
  vehicle?: Vehicle;
};

/** Everything "live" in one place: clock, today, drive (GPS + sharing), intelligence, and the map markers they imply. */
export function useTripLive({ trip, places, members, userId, enriched, votes, focusDay, showAllPlaces = false, vehicle = "car" }: Args) {
  const nowMinute = useNowMinute(); // 0 on the server → no clock mismatch
  const nowMs = nowMinute * 60_000;
  const pad = (n: number) => String(n).padStart(2, "0");
  const localNow = nowMinute ? new Date(nowMs) : null;
  const localDate = localNow ? `${localNow.getFullYear()}-${pad(localNow.getMonth() + 1)}-${pad(localNow.getDate())}` : null;
  const localTime = localNow ? `${pad(localNow.getHours())}:${pad(localNow.getMinutes())}` : null;
  // Which day is this drive on? Inside the planned dates: today's day. Just AFTER the planned end (an overnight drive that
  // crosses midnight on the last day) it is still the last day — the trip is not "in the past" while you are travelling it.
  // A trip the owner RESUMED runs today on the first day that still has something to do, whatever its planned dates say; a closed
  // (finished or cancelled) trip is shown as history and never restarts by itself.
  const resumed = isResumed(trip);
  const closed = isClosed(trip);
  const liveDay = localDate ? liveDayFor(trip, localDate, { resumedDay: resumed ? resumedDay(places, trip.num_days) : null }) : null;
  const todayDay = liveDay?.mode === "today" ? liveDay.day : null;
  const overrun = liveDay?.mode === "overrun";
  const driveDay = todayDay ?? (overrun && liveDay?.day ? liveDay.day : focusDay);

  const dayPlaces = useMemo(() => places.filter((p) => p.day_number === driveDay).sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0)), [places, driveDay]);
  const remaining = useMemo(() => dayPlaces.filter((p) => (p.status ?? "planned") === "planned"), [dayPlaces]);
  const done = dayPlaces.filter((p) => p.status === "done").length;

  // Everything this drive heads for, in order: the day's remaining stops and, when it belongs to this drive, the trip's
  // destination. A trip with a start and a destination but no stops used to have nothing to navigate to.
  const finishedToday = useMemo(() => dayPlaces.filter((p) => p.status === "done" || p.status === "skipped"), [dayPlaces]);
  const scheduledStopCount = useMemo(() => places.filter((p) => p.day_number !== null).length, [places]);
  const targets = useMemo<PlanTarget[]>(
    () => planDriveTargets({ remaining, finished: finishedToday, destination: { lat: trip.dest_lat, lng: trip.dest_lng, name: trip.dest_name }, driveDay, numDays: trip.num_days, scheduledStopCount }),
    [remaining, finishedToday, trip.dest_lat, trip.dest_lng, trip.dest_name, driveDay, trip.num_days, scheduledStopCount]
  );
  const driveStops = useMemo<DriveTarget[]>(() => targets.map((t) => ({ id: t.id, name: t.name, lat: t.lat, lng: t.lng, plannedArrival: t.plannedArrival })), [targets]);
  /** Real planned stops only: the autopilot and radar reason about places to visit, not about "the destination". */
  const stopTargets = useMemo(() => driveStops.filter((_, i) => targets[i].kind === "stop"), [driveStops, targets]);
  // Live features (ETA, advice from where you are, sharing) switch on only when the drive is confirmed AND the position is precise.
  const allowLive = useRef(false);
  const fixRef = useRef<((m: Me) => void) | null>(null); // navigation listens to every GPS fix through this
  const endRef = useRef<(() => void) | null>(null); // the drive ended by itself (location permission revoked)
  const arrivalRef = useRef<((m: Me) => void) | null>(null); // arrival detection listens to every GPS fix through this
  const drive: Drive = useDrive(trip.id, userId, driveStops, allowLive, fixRef, endRef, arrivalRef);

  const intelStops = useMemo<IntelStopInput[]>(
    () =>
      stopTargets.map((d) => {
        const e = enriched.find((x) => x.place.id === d.id);
        const v = votes[d.id];
        const goScore = e?.score?.score ?? null;
        const bits = [goScore !== null ? `Go score ${goScore}` : null, v && (v.up || v.down) ? `${v.up} up, ${v.down} down` : null].filter(Boolean);
        const cat = e?.category;
        return {
          ...d,
          visitMin: cat ? Math.round(CATEGORIES[cat].hours * 60) : 90,
          value: Math.max(0, Math.min(2, (goScore ?? 60) / 100 + (v?.score ?? 0) * 0.25 + 0.2)),
          valueNote: bits.length ? `${bits.join(" · ")}.` : null,
          outdoor: cat ? !["museum", "food", "stay"].includes(cat) : true,
        };
      }),
    [stopTargets, enriched, votes]
  );

  // Before the trip (or with GPS off) the advice is a PREVIEW from the planned starting point.
  const previewFrom = useMemo(() => {
    if (driveDay > 1) {
      const prev = places.filter((p) => p.day_number === driveDay - 1).sort((a, b) => (b.sequence_order ?? 0) - (a.sequence_order ?? 0))[0];
      if (prev) return { lat: prev.lat, lng: prev.lng, label: prev.name };
    }
    return trip.start_lat != null && trip.start_lng != null ? { lat: trip.start_lat, lng: trip.start_lng, label: trip.start_city ?? "your start" } : null;
  }, [places, driveDay, trip.start_lat, trip.start_lng, trip.start_city]);

  // ── Starting a drive: compare the plan (dates, start point) with the real date and the real position. ──
  const [confirmedSession, setConfirmedSession] = useState<number | null>(null);
  const confirmed = confirmedSession === drive.session;
  const plannedStart = useMemo(() => (previewFrom ? { lat: previewFrom.lat, lng: previewFrom.lng, label: previewFrom.label } : null), [previewFrom]);
  const timing = useMemo(() => (localDate ? tripTiming(trip, localDate) : null), [trip, localDate]);
  const startCheck = useMemo(
    () => (drive.active && drive.me && localDate ? checkStart({ trip, todayISO: localDate, quality: drive.quality, here: drive.me, plannedStart }) : null),
    [drive.active, drive.me, drive.quality, localDate, trip, plannedStart]
  );
  /** The traveller must decide before the drive goes live. */
  const gateOpen = drive.active && !!drive.me && !confirmed && !!startCheck && !startCheck.clear;
  const liveOk = drive.active && !!drive.me && !!drive.quality?.usable && (confirmed || !!startCheck?.clear);
  useEffect(() => {
    allowLive.current = liveOk;
  });
  const weatherNote = timing?.state === "before" ? `This is the weather right now, not your trip-day forecast. ${timing.headline} The forecast for each trip day is in the Go score on every stop.` : timing?.state === "after" ? (overrun ? "This is the weather right now. You're continuing past the planned end of the trip." : "This is the weather right now. The planned dates of this trip have passed.") : null;
  // "You're near Warangal": the town around you, asked once (only when you are somewhere other than the planned start).
  const away = startCheck?.issues.find((i) => i.kind === "away-from-start");
  const awayHere = away && drive.me ? { lat: drive.me.lat, lng: drive.me.lng } : null;
  const [hereName, setHereName] = useState<{ session: number; name: string | null } | null>(null);
  const lookupKey = awayHere && gateOpen ? `${drive.session}` : null;
  useEffect(() => {
    if (!lookupKey || !awayHere) return;
    let cancelled = false;
    fetch("/api/reverse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(awayHere) })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { name?: string | null } | null) => { if (!cancelled) setHereName({ session: drive.session, name: b?.name ?? null }); })
      .catch(() => { if (!cancelled) setHereName({ session: drive.session, name: null }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ask once per drive session, not on every GPS fix
  }, [lookupKey]);
  const hereLabel = hereName?.session === drive.session ? hereName.name : null;
  // The ACTUAL start of this drive, kept apart from the PLANNED start (which is never changed).
  const startedFrom = confirmed && away ? { label: hereLabel, plannedLabel: away.startLabel, km: away.km } : null;
  const gate = { open: gateOpen, confirmed, check: startCheck, confirm: () => setConfirmedSession(drive.session), plannedStart, today: localDate, driveDay, hereLabel, tripId: trip.id };

  // Turn-by-turn to the next stop (needs a confirmed drive and a precise position).
  const nextTarget = useMemo(() => (targets[0] ? { id: targets[0].id, name: targets[0].name, lat: targets[0].lat, lng: targets[0].lng, kind: targets[0].kind } : null), [targets]);
  const rawNavigation: Navigation = useNavigation({ target: nextTarget, ready: liveOk, fixRef, vehicle });
  useEffect(() => {
    endRef.current = rawNavigation.stop;
  });

  // A stop on today's route DISAPPEARED (deleted here, by another member, or while the phone slept): say where we go now.
  // Navigation itself already re-routes to the new first target; with nothing left it stops, so no old route stays on the map.
  const existingIds = useMemo(() => new Set(places.map((p) => p.id)), [places]);
  const targetRefs = useMemo(() => targets.map((t) => ({ id: t.id, name: t.name })), [targets]);
  const removal = useStopRemoved({ tripId: trip.id, targets: targetRefs, existingIds, remember: drive.active });
  const navStop = rawNavigation.stop;
  const voiceOn = rawNavigation.voice && drive.active;
  useEffect(() => {
    if (!removal.at || removal.change.kind !== "target-removed") return;
    if (!removal.change.next) navStop();
    if (voiceOn && removal.message) speak(removal.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per removal
  }, [removal.at]);
  const navigation: Navigation = useMemo(
    () => (removal.message ? { ...rawNavigation, notice: removal.message, dismissNotice: () => { removal.dismiss(); rawNavigation.dismissNotice(); } } : rawNavigation),
    [rawNavigation, removal]
  );

  // The autopilot reasons about the real stops only. When the destination was appended to the drive's road route, hand it
  // the same route without that last leg, so its own consistency check (legs ↔ stops) keeps passing.
  const intelRoute = useMemo(() => {
    const r = drive.route;
    if (!r) return null;
    const withDest = r.stopIds[r.stopIds.length - 1] === DESTINATION_ID; // the route only reaches it when it fits the ETA's stop limit
    return withDest ? { ...r, legs: r.legs.slice(0, -1), stopIds: r.stopIds.slice(0, -1) } : r;
  }, [drive.route]);

  const intel: IntelState = useIntel({
    tripId: trip.id,
    enabled: intelStops.length > 0 || liveOk,
    live: liveOk && drive.me ? { lat: drive.me.lat, lng: drive.me.lng, heading: drive.me.heading, speedKmh: drive.me.speedKmh } : null,
    preview: previewFrom ? { lat: previewFrom.lat, lng: previewFrom.lng, heading: null, speedKmh: null } : null,
    stops: intelStops,
    route: intelRoute,
    // Planned arrival times belong to the planned date, so a resumed trip is not "behind" them.
    comparePlan: todayDay !== null && driveDay === todayDay && !resumed,
    // How long the traveller said they can travel, when they resumed (the engine's "when should today end").
    dayEndMin: resumed && trip.resume_day_end_min != null ? trip.resume_day_end_min : undefined,
    drivingMin: drive.drivingMin,
    canMoveNextDay: driveDay < trip.num_days,
  });

  // Drive now = start tracking AND let navigation fetch the road route by itself once the position is precise.
  const startDrive = useCallback(() => { navigation.arm(); drive.start(); }, [navigation, drive]);
  const stopDrive = useCallback(() => { navigation.stop(); drive.stop(); }, [navigation, drive]);
  const driveWithNav: Drive = useMemo(() => ({ ...drive, start: startDrive, stop: stopDrive }), [drive, startDrive, stopDrive]);

  // How far from where I REALLY am: to the next stop and on through the remaining stops only (lib/trip/remaining.ts).
  // Every screen reads this one answer, so the Drive panel, the Live card, the progress bar, the arrival card and the map agree.
  const navProgress = navigation.phase === "navigating" && navigation.progress && navigation.target ? { targetId: navigation.target.id, remainingM: navigation.progress.remainingM, remainingS: navigation.progress.remainingS } : null;
  const distanceLeft = useMemo(
    () => (drive.active ? remainingDistance({ targets: targetRefs, route: drive.route, nav: navProgress, me: drive.me, quality: drive.quality, nowMs: drive.me?.at ?? 0 }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navProgress is rebuilt from these three every render
    [drive.active, targetRefs, drive.route, navigation.phase, navigation.progress, navigation.target, drive.me, drive.quality]
  );

  // The end of today's journey ("Vizag · 624 km · arrive 8:42 PM"), from the same numbers as everything else.
  const journey = useMemo(() => {
    const r = distanceLeft;
    if (navigation.phase !== "navigating" || !r || r.covers < 2 || !drive.me) return null;
    // A stay is counted at every target except the last (you do not "visit" the end of the journey on the way to it).
    const visitMinutes = targets.slice(0, r.covers).map((t) => (t.kind === "stop" ? intelStops.find((s) => s.id === t.id)?.visitMin ?? 0 : 0));
    const j = journeySummary({
      nowMs: drive.me.at, currentLegRemainingM: r.legs[0].km * 1000, currentLegRemainingS: r.legs[0].minutes * 60, laterLegs: r.legs.slice(1),
      visitMinutes, finalName: r.lastName,
    });
    return { ...j, remainingKm: r.totalKm, kmLabel: kmText(r.totalKm, r) };
  }, [navigation.phase, distanceLeft, drive.me, targets, intelStops]);

  const liveMarkers = useMemo<LiveMarker[]>(() => {
    const out: LiveMarker[] = [];
    if (drive.me) out.push({ id: "me", label: "You", color: "#2563EB", lat: drive.me.lat, lng: drive.me.lng, me: true, stale: drive.quality?.grade === "stale", accuracyM: drive.me.accuracyM });
    for (const m of members) {
      const l = drive.members[m.user_id];
      if (!l || m.user_id === userId) continue;
      out.push({ id: m.user_id, label: m.display_name?.[0]?.toUpperCase() ?? "?", color: safeColor(m.avatar_color), lat: l.lat, lng: l.lng, me: false, stale: nowMs > 0 && nowMs - new Date(l.updated_at).getTime() > 10 * 60_000 });
    }
    return out;
  }, [drive.me, drive.quality, drive.members, members, userId, nowMs]);

  // The map shows what the radar recommends (+ what the autopilot is suggesting), NOT every place nearby.
  const poiMarkers = useMemo<PoiMarker[]>(() => {
    const out = new Map<string, PoiMarker>();
    const recommended = new Set((intel.result?.advice ?? []).flatMap((a) => (a.options ?? []).map((o) => o.key)));
    for (const r of intel.result?.radar ?? []) out.set(r.key, { id: r.key, kind: r.kind, name: r.name, lat: r.lat, lng: r.lng, highlight: recommended.has(r.key) });
    for (const a of intel.result?.advice ?? []) for (const o of a.options ?? []) out.set(o.key, { id: o.key, kind: o.kind, name: o.name, lat: o.lat, lng: o.lng, highlight: true });
    if (showAllPlaces) {
      for (const list of Object.values(intel.result?.aheadByKind ?? {})) for (const p of list ?? []) if (!out.has(p.key)) out.set(p.key, { id: p.key, kind: p.kind, name: p.name, lat: p.lat, lng: p.lng, highlight: false });
    }
    return [...out.values()].slice(0, showAllPlaces ? 40 : 14);
  }, [intel.result, showAllPlaces]);

  const stayMinutes = (id: string) => {
    const e = enriched.find((x) => x.place.id === id);
    return e ? Math.round(CATEGORIES[e.category].hours * 60) : 0;
  };

  return { vehicle, arrivalRef, journey, distanceLeft, stopRemoved: removal, startedFrom, navigation, gate, liveOk, timing, weatherNote, nowMs, localDate, localTime, todayDay, overrun, resumed, closed, driveDay, dayPlaces, remaining, done, driveStops, targets, nextTarget, drive: driveWithNav, intel, intelStops, previewFrom, liveMarkers, poiMarkers, stayMinutes, nextStop: remaining[0] ?? null };
}
