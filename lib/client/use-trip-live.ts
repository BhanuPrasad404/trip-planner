"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import { useDrive, type Drive, type DriveTarget, type Me } from "@/lib/client/use-drive";
import { useNavigation, type Navigation } from "@/lib/client/use-navigation";
import { useIntel, type IntelState, type IntelStopInput } from "@/lib/client/use-intel";
import { useNowMinute } from "@/lib/client/use-now";
import type { Enriched } from "@/lib/client/enrich";
import { safeColor } from "@/lib/format";
import { checkStart } from "@/lib/location/start-check";
import { journeySummary } from "@/lib/map/journey";
import { tripTiming } from "@/lib/time-context";
import { tripDayForDate } from "@/lib/replan";
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
};

/** Everything "live" in one place: clock, today, drive (GPS + sharing), intelligence, and the map markers they imply. */
export function useTripLive({ trip, places, members, userId, enriched, votes, focusDay, showAllPlaces = false }: Args) {
  const nowMinute = useNowMinute(); // 0 on the server → no clock mismatch
  const nowMs = nowMinute * 60_000;
  const pad = (n: number) => String(n).padStart(2, "0");
  const localNow = nowMinute ? new Date(nowMs) : null;
  const localDate = localNow ? `${localNow.getFullYear()}-${pad(localNow.getMonth() + 1)}-${pad(localNow.getDate())}` : null;
  const localTime = localNow ? `${pad(localNow.getHours())}:${pad(localNow.getMinutes())}` : null;
  const todayDay = localDate ? tripDayForDate(trip.start_date, localDate, trip.num_days) : null;
  const driveDay = todayDay ?? focusDay;

  const dayPlaces = useMemo(() => places.filter((p) => p.day_number === driveDay).sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0)), [places, driveDay]);
  const remaining = useMemo(() => dayPlaces.filter((p) => (p.status ?? "planned") === "planned"), [dayPlaces]);
  const done = dayPlaces.filter((p) => p.status === "done").length;

  const driveStops = useMemo<DriveTarget[]>(
    () => remaining.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, plannedArrival: p.arrival_time?.slice(0, 5) ?? null })),
    [remaining]
  );
  // Live features (ETA, advice from where you are, sharing) switch on only when the drive is confirmed AND the position is precise.
  const allowLive = useRef(false);
  const fixRef = useRef<((m: Me) => void) | null>(null); // navigation listens to every GPS fix through this
  const endRef = useRef<(() => void) | null>(null); // the drive ended by itself (location permission revoked)
  const drive: Drive = useDrive(trip.id, userId, driveStops, allowLive, fixRef, endRef);

  const intelStops = useMemo<IntelStopInput[]>(
    () =>
      driveStops.map((d) => {
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
    [driveStops, enriched, votes]
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
  const weatherNote = timing?.state === "before" ? `This is the weather right now, not your trip-day forecast. ${timing.headline} The forecast for each trip day is in the Go score on every stop.` : timing?.state === "after" ? "This is the weather right now. The planned dates of this trip have passed." : null;
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
  const gate = { open: gateOpen, confirmed, check: startCheck, confirm: () => setConfirmedSession(drive.session), plannedStart, today: localDate, driveDay, hereLabel };

  // Turn-by-turn to the next stop (needs a confirmed drive and a precise position).
  const nextTarget = useMemo(() => (remaining[0] ? { id: remaining[0].id, name: remaining[0].name, lat: remaining[0].lat, lng: remaining[0].lng } : null), [remaining]);
  const navigation: Navigation = useNavigation({ target: nextTarget, ready: liveOk, fixRef });
  useEffect(() => {
    endRef.current = navigation.stop;
  });

  const intel: IntelState = useIntel({
    tripId: trip.id,
    enabled: intelStops.length > 0 || liveOk,
    live: liveOk && drive.me ? { lat: drive.me.lat, lng: drive.me.lng, heading: drive.me.heading, speedKmh: drive.me.speedKmh } : null,
    preview: previewFrom ? { lat: previewFrom.lat, lng: previewFrom.lng, heading: null, speedKmh: null } : null,
    stops: intelStops,
    route: drive.route,
    comparePlan: todayDay !== null && driveDay === todayDay,
    drivingMin: drive.drivingMin,
    canMoveNextDay: driveDay < trip.num_days,
  });

  // Drive now = start tracking AND let navigation fetch the road route by itself once the position is precise.
  const startDrive = useCallback(() => { navigation.arm(); drive.start(); }, [navigation, drive]);
  const stopDrive = useCallback(() => { navigation.stop(); drive.stop(); }, [navigation, drive]);
  const driveWithNav: Drive = useMemo(() => ({ ...drive, start: startDrive, stop: stopDrive }), [drive, startDrive, stopDrive]);

  // The end of today's journey ("Vizag · 624 km · arrive 8:42 PM"), from the same road legs as everything else.
  const journey = useMemo(() => {
    const p = navigation.progress;
    const legs = drive.route && remaining[0] && drive.route.stopIds[0] === remaining[0].id ? drive.route.legs.slice(1) : [];
    if (navigation.phase !== "navigating" || !p || legs.length === 0 || !drive.me) return null;
    const finalStop = remaining[remaining.length - 1];
    return journeySummary({
      nowMs: drive.me.at, currentLegRemainingM: p.remainingM, currentLegRemainingS: p.remainingS, laterLegs: legs,
      visitMinutes: intelStops.map((s) => s.visitMin), finalName: finalStop?.name ?? "your destination",
    });
  }, [navigation.phase, navigation.progress, drive.route, drive.me, remaining, intelStops]);

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

  return { journey, startedFrom, navigation, gate, liveOk, timing, weatherNote, nowMs, localDate, localTime, todayDay, driveDay, dayPlaces, remaining, done, driveStops, drive: driveWithNav, intel, intelStops, previewFrom, liveMarkers, poiMarkers, stayMinutes, nextStop: remaining[0] ?? null };
}
