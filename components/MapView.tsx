"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { enrichPlaces } from "@/lib/client/enrich";
import { useTripActions } from "@/lib/client/use-trip-actions";
import { useTripLive } from "@/lib/client/use-trip-live";
import type { RadarItem } from "@/lib/intel/types";
import type { PlaceWithSeason, Trip, TripMember } from "@/lib/types";
import type { VoteSummary } from "@/lib/votes";
import type { Conditions } from "@/lib/weather";
import { AheadBrowser } from "./intel/AheadBrowser";
import { RadarList } from "./intel/RadarList";
import { UndoToast } from "./intel/UndoToast";
import { WeatherSunCard } from "./intel/WeatherSunCard";
import { TripMapLazy } from "./TripMapLazy";
import { Glyph } from "@/components/ui/Glyph";
import { DriveGateCard } from "./DriveGateCard";
import { MapThemeControl } from "./map/MapThemeControl";
import { NavigationBanner, NavigationPanel } from "./map/NavigationOverlay";
import { useNavUi } from "@/lib/client/use-nav-ui";
import { useMapTheme } from "@/lib/client/use-map-theme";
import { SATELLITE_TILES_URL } from "@/lib/map/style";

type Props = { trip: Trip; places: PlaceWithSeason[]; members: TripMember[]; votes: Record<string, VoteSummary>; conditions: Record<string, Conditions>; userId: string; today: string };

const Toggle = ({ on, set, children }: { on: boolean; set: (v: boolean) => void; children: React.ReactNode }) => (
  <button type="button" aria-pressed={on} onClick={() => set(!on)} className={`min-h-10 rounded-full border px-3 text-sm font-semibold shadow-sm ${on ? "border-teal bg-teal text-white" : "border-line bg-white text-ink-muted"}`}>{children}</button>
);

/** The map as a travel instrument: your stops, the road ahead, what the radar recommends, and your friends — with layers you control. */
export function MapView({ trip, places, members, votes, conditions, userId, today }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());
  const [focusDay, setFocusDay] = useState(places.find((p) => p.day_number !== null)?.day_number ?? 1);
  const [showRadar, setShowRadar] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [sheet, setSheet] = useState(true);
  const [follow, setFollow] = useState(true);
  const [theme, setTheme] = useMapTheme();
  const [satellite, setSatellite] = useState(false);

  const enriched = useMemo(() => enrichPlaces(places, trip, today, conditions), [places, trip, today, conditions]);
  const live = useTripLive({ trip, places, members, userId, enriched, votes, focusDay, showAllPlaces: showAll });
  const actions = useTripActions({ tripId: trip.id, places, onChanged: refresh, localDate: live.localDate, localTime: live.localTime });
  const { drive, intel, driveDay, todayDay, navigation } = live;
  const navUi = useNavUi(live, follow, setFollow, (id, name) => void actions.setStatus(id, "done", `Marked ${name} done`));
  const navBusy = navUi.navBusy;
  const mapping = !!intel.coverage && intel.coverage.ready < intel.coverage.total && intel.coverage.failed === 0;

  const mapPlaces = useMemo(() => places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, day: p.day_number, order: p.sequence_order })), [places]);
  const start = useMemo(() => (trip.start_lat != null && trip.start_lng != null ? { lat: trip.start_lat, lng: trip.start_lng, label: trip.start_city ?? "Start" } : null), [trip.start_lat, trip.start_lng, trip.start_city]);
  const dest = useMemo(() => (trip.dest_lat != null && trip.dest_lng != null ? { lat: trip.dest_lat, lng: trip.dest_lng, label: trip.dest_name ?? "Destination" } : null), [trip.dest_lat, trip.dest_lng, trip.dest_name]);
  const top = intel.result?.advice[0];
  const days = Array.from({ length: trip.num_days }, (_, i) => i + 1);
  const addRadar = (r: RadarItem) => actions.insertStop({ name: r.name, lat: r.lat, lng: r.lng, category: r.kind === "viewpoint" ? "viewpoint" : null }, driveDay);

  return (
    <main id="main" className="relative h-[calc(100dvh-14.5rem)] min-h-[30rem] w-full md:h-[calc(100dvh-10.5rem)]">
      <TripMapLazy
        places={mapPlaces} start={start} destination={dest} activeDay={driveDay} fit={drive.active ? "day" : "all"} frameStartDest={!drive.active}
        live={live.liveMarkers} pois={showRadar || showAll ? live.poiMarkers : []} driveLine={drive.active && !navUi.navBusy ? drive.route?.line ?? null : null}
        follow={drive.active && follow} onUserPan={() => setFollow(false)}
        theme={theme} satellite={satellite}
        nav={navUi.nav} headingUp={navUi.headingUp} viewRequest={navUi.viewRequest} recenter={navUi.recenter} onCompass={navUi.onCompass} onSelectRoute={navigation.choose}
      />

      {/* Layers + day */}
      <div className="absolute left-3 top-3 z-20 flex max-h-[calc(100%-1.5rem)] max-w-[calc(100%-5rem)] flex-col gap-2 overflow-y-auto overscroll-contain pb-1">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Map layers">
          <Toggle on={showRadar} set={setShowRadar}>Radar</Toggle>
          <Toggle on={showAll} set={setShowAll}>All places ahead</Toggle>
          {!drive.active ? <button type="button" onClick={drive.start} className="min-h-10 rounded-full bg-marigold px-4 text-sm font-bold text-pine shadow-sm"><span className="inline-flex items-center gap-1.5"><Glyph name="play" size={16} />Start drive</span></button> : <button type="button" onClick={drive.stop} className="min-h-10 rounded-full border border-line bg-white px-4 text-sm font-semibold text-pine shadow-sm"><span className="inline-flex items-center gap-1.5"><Glyph name="stop" size={16} />Stop drive</span></button>}
          {drive.active && !follow && <button type="button" onClick={navUi.ui.onRecenter} className="min-h-10 rounded-full border border-line bg-white px-4 text-sm font-semibold text-pine shadow-sm"><span className="inline-flex items-center gap-1.5"><Glyph name="locate" size={16} />Follow me</span></button>}
        </div>
        {todayDay === null && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Day">
            {days.map((d) => <button key={d} type="button" aria-pressed={d === focusDay} onClick={() => setFocusDay(d)} className={`min-h-9 rounded-full px-3 text-xs font-semibold shadow-sm ${d === focusDay ? "bg-pine text-white" : "bg-white text-pine"}`}>Day {d}</button>)}
          </div>
        )}
        <MapThemeControl theme={theme} onChange={setTheme} satellite={SATELLITE_TILES_URL ? satellite : undefined} onSatellite={SATELLITE_TILES_URL ? setSatellite : undefined} />
        {drive.error && !drive.locating && <p role="alert" className="rounded-xl border border-clay/30 bg-clay-light px-3 py-2 text-xs font-medium text-clay-ink shadow-sm">{drive.error}</p>}
        <div className="max-w-md shadow-lg"><DriveGateCard drive={drive} gate={live.gate} /></div>
      </div>

      {/* One-line autopilot ribbon */}
      {top && !navBusy && (
        <Link href={`/trips/${trip.id}/live`} className="absolute inset-x-3 top-16 mx-auto max-w-xl rounded-2xl bg-pine/95 px-4 py-3 text-white shadow-lg backdrop-blur md:left-auto md:right-16 md:top-3 md:mx-0 md:max-w-sm">
          <span className="block font-mono text-[10px] font-semibold uppercase tracking-widest text-marigold">Next best action</span>
          <span className="block truncate text-sm font-semibold">{top.title}</span>
        </Link>
      )}

      {/* Radar sheet (hidden while you are getting directions or confirming the start, so nothing covers them) */}
      <div hidden={navBusy || live.gate.open || drive.locating} className="absolute inset-x-0 bottom-0 max-h-[55%] overflow-y-auto rounded-t-3xl bg-white shadow-[0_-6px_24px_rgba(0,0,0,.18)] md:inset-x-auto md:bottom-4 md:left-4 md:max-h-[60%] md:w-[26rem] md:rounded-3xl">
        <button type="button" onClick={() => setSheet((v) => !v)} aria-expanded={sheet} className="sticky top-0 z-10 flex min-h-12 w-full items-center justify-between rounded-t-3xl bg-white px-5 text-left">
          <span className="font-display text-base font-semibold text-pine">Travel Radar · {intel.result?.radar.length ?? 0} ahead</span>
          <span aria-hidden="true" className="text-ink-muted"><Glyph name={sheet ? "down" : "up"} size={16} /></span>
        </button>
        {sheet && (
          <div className="px-1 pb-3">
            {intel.result && <div className="mb-3"><WeatherSunCard weather={intel.result.weatherNow} sun={intel.result.sun} sunNext={intel.result.sunNext} where={live.liveOk ? "your location" : live.previewFrom?.label ?? "the start"} updatedAt={intel.updatedAt} nowMs={live.nowMs} tripNote={live.weatherNote} /></div>}
            <RadarList radar={intel.result?.radar ?? []} photos={intel.photos} mapping={mapping} trafficConnected={false} onAdd={addRadar} busy={actions.replanning} />
            <div className="mt-3"><AheadBrowser aheadByKind={intel.result?.aheadByKind ?? {}} photos={intel.photos} /></div>
          </div>
        )}
      </div>
      <NavigationBanner ui={navUi.ui} />
      <NavigationPanel ui={navUi.ui} />
      <UndoToast undo={actions.undo} busy={actions.replanning} onUndo={() => void actions.runUndo().then(() => intel.refresh())} onDismiss={actions.dismissUndo} />
    </main>
  );
}
