"use client";

// THE live drive, once for the whole app. It runs beside the pages (it renders nothing), so going from the map to the plan, to
// Discover and back, or reloading, never restarts GPS, navigation, arrival detection, alerts or the toll watch. Screens read it
// through the store (useTripEngine in DriveProvider.tsx) and show the same state at once.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAlerts } from "@/lib/client/use-alerts";
import { useVisits } from "@/lib/client/use-visits";
import { useVehicle } from "@/lib/client/use-vehicle";
import { useTripLive } from "@/lib/client/use-trip-live";
import { useTripChanges } from "@/lib/client/use-trip-changes";
import { useTollWatch, type TollView } from "@/lib/client/use-toll-watch";
import { useNavUi } from "@/lib/client/use-nav-ui";
import { useHudNotices } from "@/lib/client/use-hud-notices";
import { applyOutboxToPlaces } from "@/lib/client/outbox";
import { enrichPlaces, type Enriched } from "@/lib/client/enrich";
import { INDIA_UTC_OFFSET_MIN } from "@/lib/travel/clock";
import { DEFAULT_UI, NO_GPS_EXPIRY_MS, writeDrive, type Camera, type DriveSnapshot, type DriveUi } from "@/lib/drive/persist";
import type { HudNotice } from "@/lib/map/notices";
import type { TripData } from "@/lib/client/trip-bundle";
import type { Vehicle } from "@/lib/vehicle";
import type { PlaceWithSeason } from "@/lib/types";
import { useWeatherBoard, type WeatherBoard } from "@/lib/client/use-weather-board";
import { useWeatherDriveAlerts } from "@/lib/client/use-weather-drive-alerts";
import { useHoursDriveAlerts, type DriveHoursStop } from "@/lib/client/use-hours-drive-alerts";
import { useDeviceHere, type DeviceHere } from "@/lib/client/use-device-here";
import { liveStopEtas, roadPointsAhead } from "@/lib/forecast/route-times";
import { DEFAULT_VIEW, plannedInstant, typicalView, type ViewMode } from "@/lib/forecast/view-time";
import { tripDayISO } from "@/lib/forecast/ist";
import { tripDatesView } from "@/lib/trip/passed";
import type { BoardStop } from "@/lib/forecast/board";
import { buildRoute, project } from "@/lib/intel/route-geometry";

/** How often a drive in progress is saved at most (and always at once when something that matters changes). */
export const SAVE_EVERY_MS = 20_000;

export type Engine = {
  tripId: string;
  userId: string;
  data: TripData;
  /** The stops with this person's answers still waiting to be sent applied on top. */
  places: PlaceWithSeason[];
  enriched: Enriched[];
  visits: ReturnType<typeof useVisits>;
  alerts: ReturnType<typeof useAlerts>;
  vehicle: Vehicle;
  setVehicle: (v: Vehicle) => void;
  live: ReturnType<typeof useTripLive>;
  tolls: TollView;
  navUi: ReturnType<typeof useNavUi>;
  /** The map's messages, prioritised (the dismissals survive leaving the map). */
  notices: ReturnType<typeof useHudNotices>;
  ui: DriveUi;
  setUi: (patch: Partial<DriveUi>) => void;
  /** The map's camera as last seen: read when the map opens again, updated on every move without re-rendering anything. */
  getCamera: () => Camera | null;
  setCamera: (c: Camera) => void;
  /** A saved drive waits for one tap (location must be allowed again after the reload). */
  paused: boolean;
  /** Reload this trip's data (the page's own refresh while it is open, otherwise a browser fetch). */
  refresh: () => void;
  /** Weather for where you are and the coming stops (each at its arrival), kept fresh by itself; and the "Now / At arrival / Pick a time" choice. */
  weather: {
    board: WeatherBoard; mode: ViewMode; setMode: (m: ViewMode) => void;
    /** The minute the board is computed for (the screens use the same clock). */
    nowMs: number;
    /** Live ETA per stop id while driving (the trip's Weather page uses them for today's stops). */
    etas: Map<string, number>;
    /** Where "here" comes from: the drive's GPS, the phone's position (after "Show weather where I am"), or the planned start. */
    hereSource: "drive" | "device" | "planned" | "none";
    device: DeviceHere; requestDevice: () => void;
  };
};

export type EngineProps = {
  data: TripData;
  /** Save this drive on the phone (only the tab that holds the drive's lock does: it never overwrites another tab's drive). */
  canSave?: boolean;
  /** Start pressed while another trip is being driven: asks first (one drive at a time). False = do not start. */
  guardStart?: () => boolean;
  restore: { snapshot: DriveSnapshot; resumeGps: boolean } | null;
  refresh: () => void;
  onDriveStart: (tripId: string, tripName: string) => void;
  onDriveEnd: (tripId: string, why: "stopped" | "no-gps") => void;
  now?: () => number;
};

/** The component the app mounts once: runs the drive and publishes it to the screens. */
export function DriveEngine({ onValue, ...props }: EngineProps & { onValue: (e: Engine | null) => void }) {
  const engine = useEngineValue(props);
  // Published after every render; screens re-render from it. On unmount the app learns there is no engine for this trip any more.
  useEffect(() => { onValue(engine); });
  useEffect(() => () => onValue(null), [onValue]);
  return null;
}

/** Everything a live drive is, as one hook (the component above runs it app-wide; tests render screens through it directly). */
export function useEngineValue({ data, restore, refresh, onDriveStart, onDriveEnd, now = Date.now, canSave = true, guardStart }: EngineProps): Engine {
  const { trip, userId } = data;
  const visits = useVisits(trip.id, userId, refresh);
  const places = useMemo(() => applyOutboxToPlaces(data.places, visits.outbox.items), [data.places, visits.outbox.items]);
  const alerts = useAlerts(INDIA_UTC_OFFSET_MIN, { origin: `/trips/${trip.id}/live` });
  const [vehicle, setVehicle] = useVehicle(trip.id, userId);
  const [saved] = useState(() => restore);
  const [ui, setUiState] = useState<DriveUi>(() => saved?.snapshot.ui ?? { ...DEFAULT_UI, focusDay: places.find((p) => p.day_number !== null)?.day_number ?? 1 });
  const setUi = useCallback((patch: Partial<DriveUi>) => setUiState((u) => ({ ...u, ...patch })), []);
  const cameraRef = useRef<Camera | null>(saved?.snapshot.ui.camera ?? null);
  const getCamera = useCallback(() => cameraRef.current, []);
  const setCamera = useCallback((c: Camera) => { cameraRef.current = c; }, []);
  const [paused, setPaused] = useState(!!saved && !saved.resumeGps);
  const startedAt = useRef<number>(saved?.snapshot.startedAt ?? 0);

  const enriched = useMemo(() => enrichPlaces(places, trip, data.today, data.conditions), [places, trip, data.today, data.conditions]);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; });
  const lastFixAt = useRef<number | null>(saved?.snapshot.lastFixAt ?? null);
  const started = useCallback(() => {
    // Carrying on (after the tap) keeps the drive's start, and the GPS clock counts from the tap; a new drive starts its clocks again.
    if (startedAt.current && pausedRef.current) lastFixAt.current = now();
    else { startedAt.current = now(); lastFixAt.current = null; }
    setPaused(false);
    onDriveStart(trip.id, trip.name);
  }, [onDriveStart, trip.id, trip.name, now]);
  const ended = useCallback(() => { setPaused(false); onDriveEnd(trip.id, "stopped"); }, [onDriveEnd, trip.id]);

  const live = useTripLive({
    trip, places, members: data.members, userId, enriched, votes: data.votes, focusDay: ui.focusDay, showAllPlaces: ui.showAll && ui.page === "map", vehicle,
    mark: visits.mark, arrive: visits.arrive, note: visits.note, alerts: { prefs: alerts.prefs, notify: alerts.notify }, restore: saved, onDriveStart: started, onDriveEnd: ended,
  });
  const { drive } = live;
  // Changes made elsewhere (another member deleted a stop, or I did on another device) reach the drive at once, on every page.
  useTripChanges({ tripId: trip.id, places: data.places, driving: drive.active, onChange: refresh });
  const tolls = useTollWatch({ live, vehicle, notify: alerts.notify, dismiss: alerts.dismiss });
  const setFollow = useCallback((v: boolean) => setUi({ follow: v }), [setUi]);
  const navUi = useNavUi(live, ui.follow, setFollow, (id, name) => void visits.mark(id, "done", name, "planned"), saved?.snapshot.ui.headingUp ?? true);

  // While paused (waiting for the tap), Start means "carry on with the same drive", never a new one. And while ANOTHER trip is being
  // driven, Start asks first.
  const view = useMemo(() => {
    const go = paused ? live.drive.resume : live.drive.start;
    const start = guardStart ? () => { if (guardStart()) go(); } : go;
    return start === live.drive.start ? live : { ...live, drive: { ...live.drive, start } };
  }, [paused, live, guardStart]);

  const mapNotices = useMemo<HudNotice[]>(() => {
    const out: HudNotice[] = [];
    if (drive.error && !drive.locating) out.push({ id: "drive-error", severity: "important", text: drive.error, dismissible: false });
    if (drive.shareFailed) out.push({ id: "share-failed", severity: "info", text: "Your live location isn't reaching the group right now. Your drive and directions are not affected.", dismissible: true });
    if (tolls.unavailable) out.push({ id: "toll-unavailable", severity: "info", text: "Couldn't check this route for toll plazas, so there may be tolls ahead.", dismissible: true, autoHideMs: 15_000 });
    if (live.sound.needsTap) out.push({ id: "sound-tap", severity: "info", text: "Your drive carried on after the page reloaded. Tap the screen once to turn the chime and voice back on.", dismissible: true });
    if (live.sound.blocked) out.push({ id: "sound-blocked", severity: "info", text: `This browser blocked sound: arrivals will still show on screen${live.sound.canBuzz ? " and buzz" : ""}, but not chime. Stop and start the drive again to retry.`, dismissible: true });
    // Honest about what a web page cannot do: no alert can sound while the phone is locked or Trailmate is in the background.
    if (drive.active) out.push({ id: `screen-${drive.session}`, severity: "info", text: "Keep Trailmate open: arrival alerts can't sound while the screen is locked or you're in another app.", dismissible: true, autoHideMs: 12_000 });
    return out;
  }, [drive.error, drive.locating, drive.shareFailed, tolls.unavailable, live.sound.needsTap, live.sound.blocked, live.sound.canBuzz, drive.active, drive.session]);
  const notices = useHudNotices(mapNotices, 1);

  // ── Weather: where you are (while driving) and the day's coming stops, each at the time you will be there (lib/forecast). ──
  // Dates over (a resumed trip, or one opened late): the old planned times are history, so stops are shown for right now.
  const datesPassed = useMemo(() => tripDatesView(trip, data.today).passed, [trip, data.today]);
  const [pickedMode, setWeatherMode] = useState<ViewMode | null>(null);
  const weatherMode: ViewMode = pickedMode ?? (datesPassed ? { kind: "now" } : DEFAULT_VIEW);
  const weatherNow = live.nowMs || now();
  const visitOf = useCallback((id: string) => live.intelStops.find((x) => x.id === id)?.visitMin ?? 0, [live.intelStops]);
  const routeStops = useMemo(() => (drive.route?.stopIds ?? []).map((id) => ({ id, visitMin: visitOf(id) })), [drive.route, visitOf]);
  const etas = useMemo(() => (drive.active ? liveStopEtas(drive.route, routeStops, weatherNow) : new Map<string, number>()), [drive.active, drive.route, routeStops, weatherNow]);
  const alongKm = useMemo(() => (drive.route && drive.me ? project(buildRoute(drive.route.line), drive.me).alongM / 1000 : 0), [drive.route, drive.me]);
  const road = useMemo(() => (drive.active ? roadPointsAhead(drive.route, routeStops, etas, weatherNow, alongKm) : []), [drive.active, drive.route, routeStops, etas, weatherNow, alongKm]);
  const boardStops = useMemo<BoardStop[]>(() => live.remaining.map((p, i) => {
    const dayISO = tripDayISO(trip.start_date, p.day_number);
    return {
      id: p.id, name: p.name, lat: p.lat, lng: p.lng, isNext: i === 0, liveEta: etas.get(p.id) ?? null,
      planned: datesPassed ? null : plannedInstant(dayISO, p.arrival_time ?? null), dayISO: datesPassed ? null : dayISO, typical: typicalView(data.conditions[p.id]),
    };
  }), [live.remaining, trip.start_date, etas, data.conditions, datesPassed]);
  // Where "here" is: the drive's GPS while driving; otherwise the phone's position once the traveller asked for it; otherwise the
  // planned start, said plainly so it is never mistaken for a live position.
  const { here: device, request: requestDevice } = useDeviceHere();
  const planned = live.previewFrom;
  const hereSource: Engine["weather"]["hereSource"] = drive.active && drive.me ? "drive" : device.status === "on" ? "device" : planned ? "planned" : "none";
  const here =
    hereSource === "drive" && drive.me ? { lat: drive.me.lat, lng: drive.me.lng, label: drive.me.manual ? "Your chosen start" : "Where you are" }
    : hereSource === "device" && device.status === "on" ? { lat: device.lat, lng: device.lng, label: "Where you are" }
    : hereSource === "planned" && planned ? { lat: planned.lat, lng: planned.lng, label: planned.label, note: "Planned start, not your live location" }
    : null;
  const board = useWeatherBoard({ enabled: here !== null || boardStops.length > 0, nowMs: weatherNow, mode: weatherMode, here, stops: boardStops, road });
  useWeatherDriveAlerts(board.alerts, drive.active, weatherNow, { notify: alerts.notify, update: alerts.update, escalate: alerts.escalate, withdraw: alerts.withdraw });
  // ── Opening hours at each coming stop's LIVE arrival time (lib/travel/hours-alerts.ts): confirmed and unconfirmed hours worded apart. ──
  const hoursStops = useMemo<DriveHoursStop[]>(() => live.remaining.map((p) => ({
    id: p.id, name: p.name, etaMs: etas.get(p.id) ?? null, visitMin: visitOf(p.id), hours: p.opening_hours ?? null,
    hoursSource: p.hours_source === "traveller" ? "user" : p.hours_source === "map_data" ? "osm" : null,
    hoursConfirmed: p.hours_source === "traveller" || !!p.hours_confirmed_at,
  })), [live.remaining, etas, visitOf]);
  useHoursDriveAlerts(trip.id, drive.active, weatherNow, hoursStops, { notify: alerts.notify, update: alerts.update, escalate: alerts.escalate, withdraw: alerts.withdraw });

  // ── Ends by itself: hours without a GPS reading (a forgotten drive must not keep sharing or chiming). ──
  const fixAt = drive.me && !drive.me.manual ? drive.me.at : null;
  useEffect(() => { if (fixAt !== null) lastFixAt.current = fixAt; }, [fixAt]);
  // A saved drive left waiting for the tap expires the same way (the screen is open, but nobody is driving).
  useEffect(() => {
    if (!drive.active && !paused) return;
    const check = () => {
      const since = lastFixAt.current ?? startedAt.current;
      if (!since || now() - since <= NO_GPS_EXPIRY_MS) return;
      if (drive.active) { live.drive.stop(); onDriveEnd(trip.id, "no-gps"); }
      else { setPaused(false); onDriveEnd(trip.id, "no-gps"); }
    };
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, [drive.active, paused, live.drive, onDriveEnd, trip.id, now]);

  // ── Saved on this phone while the drive lasts (lib/drive/persist.ts): at once when something that matters changes, and at most
  //    every SAVE_EVERY_MS for the GPS time. ──
  const nav = live.navigation;
  const navRoute = nav.routes.find((r) => r.id === nav.selectedId) ?? null;
  const next = live.nextTarget ? { id: live.nextTarget.id, name: live.nextTarget.name } : null;
  const lastSave = useRef<{ at: number; key: string }>({ at: 0, key: "" });
  const routeIds = useRef<{ map: WeakMap<object, number>; n: number }>({ map: new WeakMap(), n: 0 });
  const active = drive.active || paused;
  useEffect(() => {
    if (!active || !canSave) return;
    const idOf = (o: object | null) => { if (!o) return 0; const r = routeIds.current; let n = r.map.get(o); if (!n) { n = ++r.n; r.map.set(o, n); } return n; };
    const key = JSON.stringify([drive.session, live.persistable.confirmedSession, drive.share, nav.armed, nav.target?.id ?? null, idOf(navRoute), idOf(drive.route), ui, next?.id ?? null, live.persistable.cued().length]);
    const t = now();
    if (key === lastSave.current.key && t - lastSave.current.at < SAVE_EVERY_MS) return;
    lastSave.current = { at: t, key };
    let store: Storage;
    try { store = window.localStorage; } catch { return; }
    writeDrive(store, {
      v: 1, userId, tripId: trip.id, tripName: trip.name, savedAt: t, startedAt: startedAt.current || t, lastFixAt: lastFixAt.current, session: drive.session,
      confirmedSession: live.persistable.confirmedSession, share: drive.share,
      nav: { armed: nav.armed, targetId: nav.target?.id ?? null, route: nav.phase === "navigating" ? navRoute : null },
      driveRoute: drive.route, cued: live.persistable.cued(), next, ui: { ...ui, camera: cameraRef.current },
    });
  });

  return {
    tripId: trip.id, userId, data, places, enriched, visits, alerts, vehicle, setVehicle, live: view, tolls, navUi, notices, ui, setUi, getCamera, setCamera, paused, refresh,
    weather: { board, mode: weatherMode, setMode: setWeatherMode, nowMs: weatherNow, etas, hereSource, device, requestDevice },
  };
}
