"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { LiveArrival } from "./LiveArrival";
import { VehicleSelector } from "./VehicleSelector";
import { AlertBanners } from "./AlertCenter";
import { OutboxStatus } from "./OutboxStatus";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTripActions } from "@/lib/client/use-trip-actions";
import type { RadarItem } from "@/lib/intel/types";
import type { PlaceWithSeason, Trip, TripMember } from "@/lib/types";
import type { VoteSummary } from "@/lib/votes";
import type { Conditions } from "@/lib/weather";
import { AheadBrowser } from "./intel/AheadBrowser";
import { RadarList } from "./intel/RadarList";
import { UndoToast } from "./intel/UndoToast";
import { MapWeatherLine, WeatherSheet } from "./weather/MapWeather";
import type { WeatherPanelProps } from "./weather/WeatherPanel";
import { TripMapLazy } from "./TripMapLazy";
import { Glyph } from "@/components/ui/Glyph";
import { MapSkeleton } from "@/components/ui/Skeleton";
import { DriveGateCard } from "./DriveGateCard";
import { MapThemeControl } from "./map/MapThemeControl";
import { HudNotices } from "./map/HudNotices";
import { RouteInfoButton, RouteInfoSheet, routeInfoLabel } from "./map/RouteInfo";
import { useImmersive } from "@/lib/client/use-immersive";
import { visibleAlerts } from "@/lib/map/notices";
import { NavigationBanner, NavigationPanel } from "./map/NavigationOverlay";
import { useMapTheme } from "@/lib/client/use-map-theme";
import { SATELLITE_TILES_URL } from "@/lib/map/style";
import { dayWithDate } from "@/lib/time-context";
import { useTripEngine } from "./drive/DriveProvider";
import type { Engine } from "./drive/DriveEngine";

type Props = { trip: Trip; places: PlaceWithSeason[]; members: TripMember[]; votes: Record<string, VoteSummary>; conditions: Record<string, Conditions>; userId: string; today: string };

const Toggle = ({ on, set, children }: { on: boolean; set: (v: boolean) => void; children: React.ReactNode }) => (
  <button type="button" aria-pressed={on} onClick={() => set(!on)} className={`min-h-10 rounded-full border px-3 text-sm font-semibold shadow-sm ${on ? "border-teal bg-teal text-white" : "border-line bg-white text-ink-muted"}`}>{children}</button>
);

/** The map as a travel instrument: your stops, the road ahead, what the radar recommends, and your friends — with layers you control. */
export function MapView({ trip, places, members, votes, conditions, userId, today }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());
  // The drive lives app-wide (components/drive): this page shows it. Leaving, coming back or reloading restarts nothing.
  const data = useMemo(() => ({ trip, places, members, votes, conditions, userId, today }), [trip, places, members, votes, conditions, userId, today]);
  const view = useTripEngine(data, refresh, "map");
  if (view.status === "loading") return <main id="main" className="relative h-[calc(100dvh-15.5rem)] min-h-[30rem] w-full md:h-[calc(100dvh-10.5rem)]"><MapSkeleton /></main>;
  return <MapScreen e={view.engine} />;
}

function MapScreen({ e }: { e: Engine }) {
  const { trip } = e.data;
  const { visits, places, alerts, vehicle, setVehicle, ui, setUi, live, tolls, navUi, notices } = e;
  const { focusDay, showRadar, showAll, satellite, follow } = ui;
  const setFocusDay = (d: number) => setUi({ focusDay: d });
  const setShowRadar = (v: boolean) => setUi({ showRadar: v });
  const setShowAll = (v: boolean) => setUi({ showAll: v });
  const setSatellite = (v: boolean) => setUi({ satellite: v });
  const setFollow = (v: boolean) => setUi({ follow: v });
  // The radar sheet starts folded while driving, so it does not take half of the map; the traveller opens it when they want it.
  const sheetPref = ui.sheet;
  const setSheet = (v: boolean) => setUi({ sheet: v });
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const full = useImmersive();
  const [theme, setTheme] = useMapTheme();
  useEffect(() => { if (ui.page !== "map") setUi({ page: "map" }); }, [ui.page, setUi]);

  const actions = useTripActions({ tripId: trip.id, places, onChanged: e.refresh, localDate: live.localDate, localTime: live.localTime, outbox: visits.outbox });
  const { drive, intel, driveDay, todayDay, navigation } = live;
  // A finished trip (planned dates over, not a late finish): show its saved journey, not an active drive.
  const ended = (live.closed || (live.timing?.state === "after" && !live.overrun && !live.resumed)) && !drive.active;
  const endedOn = live.timing?.lastDate && live.localDate ? dayWithDate(live.timing.lastDate, live.localDate) : null;
  const savedCounts = useMemo(() => ({ done: places.filter((p) => p.status === "done").length, skipped: places.filter((p) => p.status === "skipped").length, total: places.filter((p) => p.day_number !== null).length }), [places]);
  const navBusy = navUi.navBusy;
  const sheet = sheetPref ?? !drive.active;
  // "Mark as done" in the navigation panel goes through this page's actions, so it gets the same Undo and notice as everywhere else.
  const navTarget = navigation.target;
  const navUiUi = { ...navUi.ui, onArrivedDone: navUi.ui.onArrivedDone && navTarget ? () => void actions.setStatus(navTarget.id, "done", `Marked ${navTarget.name} done`) : undefined };
  const alertView = visibleAlerts(alerts.active, 1);
  const otherCount = notices.hidden.length + alertView.hiddenCount;
  const infoLabel = routeInfoLabel(tolls, alertView.hiddenCount, notices.hidden.length);
  const mapping = !!intel.coverage && intel.coverage.ready < intel.coverage.total && intel.coverage.failed === 0;

  const mapPlaces = useMemo(() => places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, day: p.day_number, order: p.sequence_order, status: p.status ?? null })), [places]);
  const start = useMemo(() => (trip.start_lat != null && trip.start_lng != null ? { lat: trip.start_lat, lng: trip.start_lng, label: trip.start_city ?? "Start" } : null), [trip.start_lat, trip.start_lng, trip.start_city]);
  const dest = useMemo(() => (trip.dest_lat != null && trip.dest_lng != null ? { lat: trip.dest_lat, lng: trip.dest_lng, label: trip.dest_name ?? "Destination" } : null), [trip.dest_lat, trip.dest_lng, trip.dest_name]);
  const top = intel.result?.advice.find((x) => x.kind !== "weather"); // weather on screen comes only from the weather line and panel
  const days = Array.from({ length: trip.num_days }, (_, i) => i + 1);
  const addRadar = (r: RadarItem) => actions.insertStop({ name: r.name, lat: r.lat, lng: r.lng, category: r.kind === "viewpoint" ? "viewpoint" : null }, driveDay);

  const pill = "min-h-11 rounded-full px-4 text-sm font-semibold shadow-sm";
  const iconBtn = "grid h-11 w-11 place-items-center rounded-full border border-line bg-white text-pine shadow-sm";
  const nothingCovers = navBusy || live.gate.open || drive.locating || ended;
  // The weather panel opens over the map from the weather line (the map stays underneath).
  const [weatherOpen, setWeatherOpen] = useState(false);
  const weatherNow = e.weather.nowMs;
  const weatherPanel: WeatherPanelProps = {
    board: e.weather.board, mode: e.weather.mode, setMode: e.weather.setMode, nowMs: weatherNow,
    hereSource: e.weather.hereSource, device: e.weather.device, requestDevice: e.weather.requestDevice, limit: 4, allStopsHref: `/trips/${trip.id}/weather`,
  };
  const inFull = full.immersive;

  return (
    <main id="main" className={inFull ? "fixed inset-0 z-[60] bg-sky" : "relative h-[calc(100dvh-15.5rem)] min-h-[30rem] w-full md:h-[calc(100dvh-10.5rem)]"}>
      <TripMapLazy
        layoutKey={inFull ? "full" : "page"}
        places={mapPlaces} start={start} destination={dest} activeDay={driveDay} fit={drive.active ? "day" : "all"} frameStartDest={!drive.active} numDays={trip.num_days} journey={ended}
        live={live.liveMarkers} pois={showRadar || showAll ? live.poiMarkers : []} driveLine={drive.active && !navUi.navBusy ? drive.route?.line ?? null : null}
        follow={drive.active && follow} onUserPan={() => setFollow(false)}
        initialCamera={e.getCamera()} onCamera={e.setCamera}
        theme={theme} satellite={satellite}
        nav={navUi.nav} headingUp={navUi.headingUp} viewRequest={navUi.viewRequest} recenter={navUi.recenter} onCompass={navUi.onCompass} onSelectRoute={navigation.choose}
      />

      {/* ONE top stack, in normal flow: the turn banner, the controls, then at most one message. Nothing in it can overlap anything else. */}
      <div className="pointer-events-none absolute left-0 top-0 z-30 flex max-h-full w-full flex-col gap-2 overflow-y-auto overscroll-contain px-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:max-w-md [&>*]:pointer-events-auto">
        <NavigationBanner ui={navUi.ui} inFlow />
        {/* Weather: while driving, ONE line only when something matters; not driving, the calm line (here when the radar sheet is hidden). */}
        {(drive.active || nothingCovers || inFull) && <MapWeatherLine board={e.weather.board} driving={drive.active} nowMs={weatherNow} onOpen={() => setWeatherOpen(true)} />}

        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Drive">
            {!drive.active ? (
              <button type="button" onClick={drive.start} className={`${pill} font-bold ${ended && !e.paused ? "border border-line bg-white text-pine" : "bg-marigold text-pine"}`}><span className="inline-flex items-center gap-1.5"><Glyph name="play" size={16} />{e.paused ? "Resume drive" : ended ? "Drive this route again" : "Start drive"}</span></button>
            ) : (
              <button type="button" onClick={drive.stop} className={`${pill} border border-line bg-white text-pine`}><span className="inline-flex items-center gap-1.5"><Glyph name="stop" size={16} />Stop drive</span></button>
            )}
            {drive.active && <button type="button" onClick={live.sound.toggle} aria-pressed={live.sound.on} aria-label="Drive sounds (voice and arrival chime)" className={iconBtn}><Glyph name={live.sound.on ? "volumeOn" : "volumeOff"} size={18} /></button>}
            {drive.active && !follow && <button type="button" onClick={navUi.ui.onRecenter} className={`${pill} border border-line bg-white text-pine`}><span className="inline-flex items-center gap-1.5"><Glyph name="locate" size={16} />Follow me</span></button>}
            {!drive.active && todayDay === null && !ended && !live.overrun && days.map((d) => <button key={d} type="button" aria-pressed={d === focusDay} onClick={() => setFocusDay(d)} className={`min-h-11 rounded-full px-3.5 text-sm font-semibold shadow-sm ${d === focusDay ? "bg-pine text-white" : "bg-white text-ink-muted"}`}>Day {d}</button>)}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {infoLabel && <RouteInfoButton label={infoLabel} open={infoOpen} warn={tolls.unavailable || (!!tolls.next && tolls.next.aheadM <= 5_000)} onClick={() => { setInfoOpen((v) => !v); setOptionsOpen(false); }} />}
            <button type="button" onClick={() => { setOptionsOpen((v) => !v); setInfoOpen(false); }} aria-expanded={optionsOpen} aria-label="Map options" className={iconBtn}><Glyph name="layers" size={18} /></button>
            <button type="button" onClick={full.toggle} aria-pressed={inFull} aria-label={inFull ? "Exit full screen map" : "Expand map to full screen"} className={iconBtn}><Glyph name={inFull ? "shrink" : "expand"} size={18} /></button>
          </div>
        </div>

        {optionsOpen && (
          <div role="group" aria-label="Map options" className="space-y-2 rounded-2xl border border-line bg-white/95 p-3 shadow-xl">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Map layers">
              <Toggle on={showRadar} set={setShowRadar}>Radar</Toggle>
              <Toggle on={showAll} set={setShowAll}>All places ahead</Toggle>
            </div>
            <VehicleSelector compact value={vehicle} onChange={(v) => { setVehicle(v); if (live.navigation.phase !== "idle") window.setTimeout(live.navigation.retry, 0); }} />
            <MapThemeControl theme={theme} onChange={setTheme} satellite={SATELLITE_TILES_URL ? satellite : undefined} onSatellite={SATELLITE_TILES_URL ? setSatellite : undefined} />
          </div>
        )}
        {infoOpen && <RouteInfoSheet tolls={tolls} alerts={alerts.history} other={notices.hidden} onClose={() => setInfoOpen(false)} />}

        {ended && (
          <div role="status" className="max-w-xs rounded-2xl border border-line bg-white/95 px-3 py-2 text-xs text-ink-muted shadow-sm">
            <p className="font-semibold text-pine">Trip ended{endedOn ? ` · ${endedOn}` : ""}</p>
            <p className="mt-0.5">Saved route and stops{savedCounts.total > 0 ? `: ${savedCounts.done} done, ${savedCounts.skipped} skipped, ${savedCounts.total - savedCounts.done - savedCounts.skipped} not marked` : ""}.</p>
          </div>
        )}

        <AlertBanners placement="inline" alerts={alertView.shown} onDismiss={alerts.dismiss} onAction={alerts.act} />
        <HudNotices shown={notices.shown} hiddenCount={0} onDismiss={notices.dismiss} />
        {otherCount > 0 && !infoOpen && <button type="button" onClick={() => { setInfoOpen(true); setOptionsOpen(false); }} className="min-h-11 self-start rounded-full border border-line bg-white px-3 text-xs font-semibold text-pine shadow">{otherCount} more message{otherCount === 1 ? "" : "s"}</button>}
        <div className="empty:hidden"><DriveGateCard drive={drive} gate={live.gate} /></div>

        {top && !navBusy && !ended && !inFull && navigation.phase !== "navigating" && (
          <Link href={`/trips/${trip.id}/live`} className="block rounded-2xl bg-pine/95 px-4 py-3 text-white shadow-lg backdrop-blur">
            <span className="block font-mono text-[10px] font-semibold uppercase tracking-widest text-marigold">Suggested next step</span>
            <span className="block truncate text-sm font-semibold">{top.title}</span>
          </Link>
        )}
      </div>

      {/* Radar sheet: folded while driving, and hidden while you are getting directions, confirming the start, or in full screen, so nothing covers them. */}
      <div hidden={nothingCovers || inFull} className="absolute inset-x-0 bottom-0 max-h-[55%] overflow-y-auto rounded-t-3xl bg-white shadow-[0_-6px_24px_rgba(0,0,0,.18)] md:inset-x-auto md:bottom-4 md:left-4 md:w-96 md:rounded-3xl">
        {!drive.active && <div className="px-2 pt-2"><MapWeatherLine board={e.weather.board} driving={false} nowMs={weatherNow} onOpen={() => setWeatherOpen(true)} /></div>}
        <button type="button" onClick={() => setSheet(!sheet)} aria-expanded={sheet} className="sticky top-0 z-10 flex min-h-12 w-full items-center justify-between rounded-t-3xl bg-white px-5 text-left">
          <span className="font-display text-base font-semibold text-pine">Travel Radar · {intel.result?.radar.length ?? 0} ahead</span>
          <span aria-hidden="true" className="text-ink-muted"><Glyph name={sheet ? "down" : "up"} size={16} /></span>
        </button>
        {sheet && (
          <div className="px-1 pb-3">
            <RadarList radar={intel.result?.radar ?? []} photos={intel.photos} mapping={mapping} trafficConnected={false} onAdd={addRadar} busy={actions.replanning} />
            <div className="mt-3"><AheadBrowser aheadByKind={intel.result?.aheadByKind ?? {}} photos={intel.photos} /></div>
          </div>
        )}
      </div>
      <NavigationPanel ui={navUiUi} />
      <WeatherSheet open={weatherOpen} onClose={() => setWeatherOpen(false)} panel={weatherPanel} />
      <OutboxStatus outbox={visits.outbox} floating />
      <LiveArrival live={live} vehicle={vehicle} failed={visits.failed} onClearFailed={visits.clearFailed} />
      <UndoToast undo={actions.undo} busy={actions.replanning} onUndo={() => void actions.runUndo().then(() => intel.refresh())} onDismiss={actions.dismissUndo} />
    </main>
  );
}