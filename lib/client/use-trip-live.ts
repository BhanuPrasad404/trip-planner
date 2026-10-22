"use client";

import type { Vehicle } from "@/lib/vehicle";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import { INDIA_UTC_OFFSET_MIN, clockOf, dateOf } from "@/lib/travel/clock";
import { useDrive, type Drive, type DriveTarget, type Me } from "@/lib/client/use-drive";
import { speak, useNavigation, type Navigation } from "@/lib/client/use-navigation";
import { useArrival, withoutStaleApproach } from "@/lib/client/use-arrival";
import { useDriveSound } from "@/lib/client/use-drive-sound";
import { driveAudioState, playChime, unlockDriveAudio, vibrate, type AudioUnlock, type ChimeKind } from "@/lib/client/drive-audio";
import { approachText, arrivedText, deliverCue, type CueText } from "@/lib/client/arrival-cue";
import type { VisitStatus } from "@/lib/client/visit-queue";
import type { AlertPrefs } from "@/lib/alerts/prefs";
import type { AppAlert } from "@/lib/alerts/delivery";
import type { ArrivalStatus, ArrivalStop } from "@/lib/trip/arrival";
import type { DriveSnapshot } from "@/lib/drive/persist";
import { canVibrate } from "@/lib/client/alert-channels";
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
  /** Marks a stop (works offline: queued until there is signal). Needed for "Mark as done" on the arrival card. */
  mark?: (placeId: string, status: VisitStatus, name?: string) => Promise<"saved" | "queued">;
  /** The traveller's alert choices and the alert centre, used to reach them when Trailmate is in the background. */
  alerts?: { prefs: AlertPrefs; notify: (a: AppAlert) => boolean };
  /** A drive saved on this phone to carry on with (after a reload). `resumeGps`: location is already allowed, so follow GPS at once. */
  restore?: { snapshot: DriveSnapshot; resumeGps: boolean } | null;
  /** Told when a drive starts (or carries on) and when it ends, so the app can keep ONE active drive. */
  onDriveStart?: () => void;
  onDriveEnd?: () => void;
};

const noMark = async (): Promise<"saved" | "queued"> => "saved";
const noop = () => {};

/** Everything "live" in one place: clock, today, drive (GPS + sharing), intelligence, and the map markers they imply. */
export function useTripLive({ trip, places, members, userId, enriched, votes, focusDay, showAllPlaces = false, vehicle = "car", mark = noMark, alerts, restore = null, onDriveStart, onDriveEnd }: Args) {
  // Read once: what a saved drive brings back (the same drive number, so its decisions and alerts stay valid).
  const [saved] = useState(() => restore);
  const nowMinute = useNowMinute(); // 0 on the server → no clock mismatch
  const nowMs = nowMinute * 60_000;
  // "Today" and "now" are India time (+5:30) whatever time zone the phone is set to: a trip in India runs on India's calendar
  // (a phone still on Tokyo or New York time must not move the drive to another day, or show another day's stops and weather).
  const localDate = nowMinute ? dateOf(nowMs, INDIA_UTC_OFFSET_MIN) : null;
  const localTime = nowMinute ? clockOf(nowMs, INDIA_UTC_OFFSET_MIN) : null;
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
  const drive: Drive = useDrive(trip.id, userId, driveStops, allowLive, fixRef, endRef, arrivalRef, saved ? { session: saved.snapshot.session, share: saved.snapshot.share, active: saved.resumeGps, route: saved.snapshot.driveRoute } : null);

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
  const [confirmedSession, setConfirmedSession] = useState<number | null>(saved?.snapshot.confirmedSession ?? null);
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

  // ── Sounds: ONE switch for the voice and the arrival chime; sound is unlocked by the Start-drive tap (browser autoplay rules). ──
  const [soundOn, toggleSound] = useDriveSound();
  /** Muting also stops what is being said right now (a turn instruction, an arrival line). */
  const toggleDriveSound = useCallback(() => {
    if (soundOn && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    toggleSound();
  }, [soundOn, toggleSound]);
  // After a reload the browser needs a tap again before it may play sound: `restored` says so (see the tap listener below).
  const [audio, setAudio] = useState<{ session: number; state: AudioUnlock; restored?: boolean } | null>(saved?.resumeGps ? { session: saved.snapshot.session, state: "blocked", restored: true } : null);
  const cueCtx = useRef({ soundOn, prefs: alerts?.prefs ?? null, notify: alerts?.notify ?? null });
  useEffect(() => { cueCtx.current = { soundOn, prefs: alerts?.prefs ?? null, notify: alerts?.notify ?? null }; });
  const cued = useRef<{ session: number; keys: Set<string> }>(saved ? { session: saved.snapshot.session, keys: new Set(saved.snapshot.cued) } : { session: -1, keys: new Set() });
  /** Tell the traveller ONCE per stop per drive. In the app: chime, buzz and voice. In the background: a phone notification. */
  const cue = useCallback((kind: ChimeKind, stop: { id: string; name: string }, text: CueText) => {
    if (cued.current.session !== drive.session) cued.current = { session: drive.session, keys: new Set() };
    const key = `${kind}:${stop.id}`;
    if (cued.current.keys.has(key)) return;
    cued.current.keys.add(key);
    const { soundOn: on, prefs, notify } = cueCtx.current;
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    deliverCue(kind, stop.id, text, { hidden, soundOn: on, prefs }, { chime: playChime, vibrate, speak, notify, later: (fn, ms) => void window.setTimeout(fn, ms), stillOn: () => cueCtx.current.soundOn });
  }, [drive.session]);

  // Turn-by-turn to the next stop (needs a confirmed drive and a precise position).
  const nextTarget = useMemo(() => (targets[0] ? { id: targets[0].id, name: targets[0].name, lat: targets[0].lat, lng: targets[0].lng, kind: targets[0].kind } : null), [targets]);
  const rawNavigation: Navigation = useNavigation({
    target: nextTarget, ready: liveOk, fixRef, vehicle, voice: soundOn, onToggleVoice: toggleDriveSound, restore: saved?.resumeGps ? saved.snapshot.nav : null,
    // The end of the road line is NOT an arrival by itself (it has no speed, stay or accuracy rule: driving past would count). Only the
    // arrival detector announces arrivals; this keeps navigation's own fallback voice quiet.
    onArrive: noop,
  });
  useEffect(() => {
    endRef.current = rawNavigation.stop;
  });

  // A stop on today's route DISAPPEARED (deleted here, by another member, or while the phone slept): say where we go now.
  // Navigation itself already re-routes to the new first target; with nothing left it stops, so no old route stays on the map.
  const existingIds = useMemo(() => new Set(places.map((p) => p.id)), [places]);
  const targetRefs = useMemo(() => targets.map((t) => ({ id: t.id, name: t.name })), [targets]);
  const removal = useStopRemoved({ tripId: trip.id, userId, targets: targetRefs, existingIds, remember: drive.active });
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

  // ── Arrival: "Arriving in 100 m", then "You have arrived at X" with "Mark as done". One detector for every screen. ──
  const arrivalStops = useMemo<ArrivalStop[]>(() => {
    const list: ArrivalStop[] = dayPlaces.map((p, i) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, category: p.category ?? null, status: (p.status ?? "planned") as ArrivalStatus, order: i + 1, kind: "stop" }));
    const dest = targets.find((t) => t.kind === "destination");
    if (dest) list.push({ id: dest.id, name: dest.name, lat: dest.lat, lng: dest.lng, category: null, status: "planned", order: list.length + 1, kind: "destination" });
    return list;
  }, [dayPlaces, targets]);
  const stopDriveRef = useRef<() => void>(() => {});
  const arrival = useArrival({
    tripId: trip.id, userId, stops: arrivalStops, targetId: nextTarget?.id ?? null, enabled: liveOk, session: drive.session, arrivalRef, mark,
    onApproach: (s, i) => cue("approach", s, approachText(s.name, i.distanceM)),
    onPrompt: (s, i) => cue("arrived", s, arrivedText(s.name, i.area)),
    onFinish: () => stopDriveRef.current(),
  });

  // Drive now = start tracking AND let navigation fetch the road route by itself once the position is precise.
  // This runs inside the tap, which is the one moment browsers allow a page to unlock sound for later.
  const startDrive = useCallback(() => {
    const session = drive.session + 1;
    setAudio({ session, state: unlockDriveAudio() });
    // Unlocking can finish a moment after the tap (iPhone): look again before saying sound is blocked.
    window.setTimeout(() => setAudio((a) => (a && a.session === session ? { session, state: driveAudioState() } : a)), 800);
    navigation.arm(); drive.start();
    onDriveStart?.();
  }, [navigation, drive, onDriveStart]);
  /** Carry on with the SAME drive (location had to be allowed again after a reload). From a tap, so sound is unlocked too. */
  const resumeDrive = useCallback(() => {
    setAudio({ session: drive.session, state: unlockDriveAudio() });
    navigation.arm(); drive.resume();
    onDriveStart?.();
  }, [navigation, drive, onDriveStart]);
  const stopDrive = useCallback(() => { navigation.stop(); drive.stop(); onDriveEnd?.(); }, [navigation, drive, onDriveEnd]);
  // The browser refused location for good (or it was revoked): the drive has ended by itself.
  const wasActive = useRef(drive.active);
  useEffect(() => {
    if (wasActive.current && !drive.active) onDriveEnd?.();
    wasActive.current = drive.active;
  }, [drive.active, onDriveEnd]);
  // Sound needs a tap after a reload (or when the Start tap could not unlock it): the next tap ANYWHERE unlocks it.
  const needsTap = drive.active && audio?.session === drive.session && audio.state !== "running" && audio.state !== "unsupported";
  useEffect(() => {
    if (!needsTap) return;
    const onTap = () => setAudio((a) => (a ? { ...a, state: unlockDriveAudio(), restored: false } : a));
    window.addEventListener("pointerdown", onTap, { capture: true });
    window.addEventListener("keydown", onTap, { capture: true });
    return () => { window.removeEventListener("pointerdown", onTap, { capture: true }); window.removeEventListener("keydown", onTap, { capture: true }); };
  }, [needsTap]);
  useEffect(() => { stopDriveRef.current = stopDrive; });
  const driveWithNav: Drive = useMemo(() => ({ ...drive, start: startDrive, resume: resumeDrive, stop: stopDrive }), [drive, startDrive, resumeDrive, stopDrive]);
  /** `blocked`: the browser refused to unlock sound for this drive (alerts are still shown and buzzed). */
  const sound = {
    on: soundOn, toggle: toggleDriveSound, blocked: drive.active && soundOn && audio?.session === drive.session && audio.state === "blocked" && !audio.restored,
    /** Carried on after a reload: one tap anywhere turns the chime and voice back on (browsers require it). */
    needsTap: drive.active && soundOn && audio?.session === drive.session && audio.state === "blocked" && !!audio.restored,
    /** Whether arrivals will buzz (iPhone browsers cannot vibrate; the traveller can switch it off). */
    canBuzz: canVibrate() && alerts?.prefs.haptics !== false && alerts?.prefs.enabled !== false,
  };
  const arrivalView = withoutStaleApproach(arrival, navigation.phase);

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
    return { ...j, remainingKm: r.totalKm, kmLabel: kmText(r.totalKm, r), coversAll: r.coversAll };
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

  /** What a saved drive needs to carry on (lib/drive/persist.ts). Read when saving; not part of what screens show. */
  const persistable = { confirmedSession, cued: () => (cued.current.session === drive.session ? [...cued.current.keys] : []) };
  return { vehicle, arrivalRef, arrival: arrivalView, sound, persistable, journey, distanceLeft, stopRemoved: removal, startedFrom, navigation, gate, liveOk, timing, weatherNote, nowMs, localDate, localTime, todayDay, overrun, resumed, closed, driveDay, dayPlaces, remaining, done, driveStops, targets, nextTarget, drive: driveWithNav, intel, intelStops, previewFrom, liveMarkers, poiMarkers, stayMinutes, nextStop: remaining[0] ?? null };
}

