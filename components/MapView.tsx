"use client";

import { useMemo, useState, useTransition } from "react";
import { LiveArrival } from "./LiveArrival";
import { VehicleSelector } from "./VehicleSelector";
import { useVehicle } from "@/lib/client/use-vehicle";
import { AlertBanners } from "./AlertCenter";
import { useAlerts } from "@/lib/client/use-alerts";
import { INDIA_UTC_OFFSET_MIN } from "@/lib/travel/clock";
import { useVisits } from "@/lib/client/use-visits";
import { applyOutboxToPlaces } from "@/lib/client/outbox";
import { OutboxStatus } from "./OutboxStatus";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { enrichPlaces } from "@/lib/client/enrich";
import { useTripActions } from "@/lib/client/use-trip-actions";
import { useTripLive } from "@/lib/client/use-trip-live";
import { useTripChanges } from "@/lib/client/use-trip-changes";
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
import { HudNotices } from "./map/HudNotices";
import { RouteInfoButton, RouteInfoSheet, routeInfoLabel } from "./map/RouteInfo";
import { useHudNotices } from "@/lib/client/use-hud-notices";
import { useImmersive } from "@/lib/client/use-immersive";
import { useTollWatch } from "@/lib/client/use-toll-watch";
import { visibleAlerts, type HudNotice } from "@/lib/map/notices";
import { NavigationBanner, NavigationPanel } from "./map/NavigationOverlay";
import { useNavUi } from "@/lib/client/use-nav-ui";
import { useMapTheme } from "@/lib/client/use-map-theme";
import { SATELLITE_TILES_URL } from "@/lib/map/style";
import { dayWithDate } from "@/lib/time-context";

type Props = { trip: Trip; places: PlaceWithSeason[]; members: TripMember[]; votes: Record<string, VoteSummary>; conditions: Record<string, Conditions>; userId: string; today: string };

const Toggle = ({ on, set, children }: { on: boolean; set: (v: boolean) => void; children: React.ReactNode }) => (
  <button type="button" aria-pressed={on} onClick={() => set(!on)} className={`min-h-10 rounded-full border px-3 text-sm font-semibold shadow-sm ${on ? "border-teal bg-teal text-white" : "border-line bg-white text-ink-muted"}`}>{children}</button>
);

/** The map as a travel instrument: your stops, the road ahead, what the radar recommends, and your friends — with layers you control. */
export function MapView({ trip, places: serverPlaces, members, votes, conditions, userId, today }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());
  // Changes made with no signal (this person's own, on this trip) are shown at once and sent when the connection is back.
  const visits = useVisits(trip.id, userId, refresh);
  const places = useMemo(() => applyOutboxToPlaces(serverPlaces, visits.outbox.items), [serverPlaces, visits.outbox.items]);
  // Also tell the traveller if Trailmate is in the background (the card itself is the alert while the app is open).
  const alerts = useAlerts(INDIA_UTC_OFFSET_MIN, { origin: `/trips/${trip.id}/live` });
  const onArrivalPrompt = (stop: { id: string; name: string }) => alerts.notify({ id: `arrival:${stop.id}`, kind: "arrival", level: 2, title: `You've arrived at ${stop.name}`, body: "Open Trailmate to mark this stop as visited.", inApp: false, cooldownMs: 12 * 3_600_000 });
  const [focusDay, setFocusDay] = useState(places.find((p) => p.day_number !== null)?.day_number ?? 1);
  const [showRadar, setShowRadar] = useState(true);
  const [showAll, setShowAll] = useState(false);
  // The radar sheet starts folded while driving, so it does not take half of the map; the traveller opens it when they want it.
  const [sheetPref, setSheet] = useState<boolean | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const full = useImmersive();
  const [follow, setFollow] = useState(true);
  const [theme, setTheme] = useMapTheme();
  const [satellite, setSatellite] = useState(false);

  const enriched = useMemo(() => enrichPlaces(places, trip, today, conditions), [places, trip, today, conditions]);
  const [vehicle, setVehicle] = useVehicle(trip.id);
  const live = useTripLive({ trip, places, members, userId, enriched, votes, focusDay, showAllPlaces: showAll, vehicle });
  const actions = useTripActions({ tripId: trip.id, places, onChanged: refresh, localDate: live.localDate, localTime: live.localTime, outbox: visits.outbox });
  const { drive, intel, driveDay, todayDay, navigation } = live;
  // Changes made elsewhere (another member deleted a stop, or I did on another device) reach this map at once.
  useTripChanges({ tripId: trip.id, places: serverPlaces, driving: drive.active, onChange: refresh });
  // A finished trip (planned dates over, not a late finish): show its saved journey, not an active drive.
  const ended = (live.closed || (live.timing?.state === "after" && !live.overrun && !live.resumed)) && !drive.active;
  const endedOn = live.timing?.lastDate && live.localDate ? dayWithDate(live.timing.lastDate, live.localDate) : null;
  const savedCounts = useMemo(() => ({ done: places.filter((p) => p.status === "done").length, skipped: places.filter((p) => p.status === "skipped").length, total: places.filter((p) => p.day_number !== null).length }), [places]);
  const navUi = useNavUi(live, follow, setFollow, (id, name) => void actions.setStatus(id, "done", `Marked ${name} done`));
  const navBusy = navUi.navBusy;
  const sheet = sheetPref ?? !drive.active;
  const tolls = useTollWatch({ live, vehicle, notify: alerts.notify, dismiss: alerts.dismiss });
  const mapNotices = useMemo<HudNotice[]>(() => {
    const out: HudNotice[] = [];
    if (drive.error && !drive.locating) out.push({ id: "drive-error", severity: "important", text: drive.error, dismissible: false });
    if (drive.shareFailed) out.push({ id: "share-failed", severity: "info", text: "Your live location isn't reaching the group right now. Your drive and directions are not affected.", dismissible: true });
    if (tolls.unavailable) out.push({ id: "toll-unavailable", severity: "info", text: "Couldn't check this route for toll plazas, so there may be tolls ahead.", dismissible: true, autoHideMs: 15_000 });
    return out;
  }, [drive.error, drive.locating, drive.shareFailed, tolls.unavailable]);
  const notices = useHudNotices(mapNotices, 1);
  const alertView = visibleAlerts(alerts.active, 1);
  const otherCount = notices.hidden.length + alertView.hiddenCount;
  const infoLabel = routeInfoLabel(tolls, alertView.hiddenCount, notices.hidden.length);
  const mapping = !!intel.coverage && intel.coverage.ready < intel.coverage.total && intel.coverage.failed === 0;

  const mapPlaces = useMemo(() => places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, day: p.day_number, order: p.sequence_order, status: p.status ?? null })), [places]);
  const start = useMemo(() => (trip.start_lat != null && trip.start_lng != null ? { lat: trip.start_lat, lng: trip.start_lng, label: trip.start_city ?? "Start" } : null), [trip.start_lat, trip.start_lng, trip.start_city]);
  const dest = useMemo(() => (trip.dest_lat != null && trip.dest_lng != null ? { lat: trip.dest_lat, lng: trip.dest_lng, label: trip.dest_name ?? "Destination" } : null), [trip.dest_lat, trip.dest_lng, trip.dest_name]);
  const top = intel.result?.advice[0];
  const days = Array.from({ length: trip.num_days }, (_, i) => i + 1);
  const addRadar = (r: RadarItem) => actions.insertStop({ name: r.name, lat: r.lat, lng: r.lng, category: r.kind === "viewpoint" ? "viewpoint" : null }, driveDay);

  const pill = "min-h-11 rounded-full px-4 text-sm font-semibold shadow-sm";
  const iconBtn = "grid h-11 w-11 place-items-center rounded-full border border-line bg-white text-pine shadow-sm";
  const nothingCovers = navBusy || live.gate.open || drive.locating || ended;
  const inFull = full.immersive;

  return (
    <main id="main" className={inFull ? "fixed inset-0 z-[60] bg-sky" : "relative h-[calc(100dvh-15.5rem)] min-h-[30rem] w-full md:h-[calc(100dvh-10.5rem)]"}>
      <TripMapLazy
        layoutKey={inFull ? "full" : "page"}
        places={mapPlaces} start={start} destination={dest} activeDay={driveDay} fit={drive.active ? "day" : "all"} frameStartDest={!drive.active} numDays={trip.num_days} journey={ended}
        live={live.liveMarkers} pois={showRadar || showAll ? live.poiMarkers : []} driveLine={drive.active && !navUi.navBusy ? drive.route?.line ?? null : null}
        follow={drive.active && follow} onUserPan={() => setFollow(false)}
        theme={theme} satellite={satellite}
        nav={navUi.nav} headingUp={navUi.headingUp} viewRequest={navUi.viewRequest} recenter={navUi.recenter} onCompass={navUi.onCompass} onSelectRoute={navigation.choose}
      />

      {/* ONE top stack, in normal flow: the turn banner, the controls, then at most one message. Nothing in it can overlap anything else. */}
      <div className="pointer-events-none absolute left-0 top-0 z-30 flex max-h-full w-full flex-col gap-2 overflow-y-auto overscroll-contain px-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:max-w-md [&>*]:pointer-events-auto">
        <NavigationBanner ui={navUi.ui} inFlow />

        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Drive">
            {!drive.active ? (
              <button type="button" onClick={drive.start} className={`${pill} font-bold ${ended ? "border border-line bg-white text-pine" : "bg-marigold text-pine"}`}><span className="inline-flex items-center gap-1.5"><Glyph name="play" size={16} />{ended ? "Drive this route again" : "Start drive"}</span></button>
            ) : (
              <button type="button" onClick={drive.stop} className={`${pill} border border-line bg-white text-pine`}><span className="inline-flex items-center gap-1.5"><Glyph name="stop" size={16} />Stop drive</span></button>
            )}
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
        <button type="button" onClick={() => setSheet(!sheet)} aria-expanded={sheet} className="sticky top-0 z-10 flex min-h-12 w-full items-center justify-between rounded-t-3xl bg-white px-5 text-left">
          <span className="font-display text-base font-semibold text-pine">Travel Radar · {intel.result?.radar.length ?? 0} ahead</span>
          <span aria-hidden="true" className="text-ink-muted"><Glyph name={sheet ? "down" : "up"} size={16} /></span>
        </button>
        {sheet && (
          <div className="px-1 pb-3">
            {intel.result && <div className="mb-3"><WeatherSunCard weather={intel.result.weatherNow} sun={intel.result.sun} sunNext={intel.result.sunNext} where={live.liveOk ? "your location" : live.previewFrom?.label ?? "the start"} updatedAt={intel.updatedAt} /></div>}
            <RadarList radar={intel.result?.radar ?? []} photos={intel.photos} mapping={mapping} trafficConnected={false} onAdd={addRadar} busy={actions.replanning} />
            <div className="mt-3"><AheadBrowser aheadByKind={intel.result?.aheadByKind ?? {}} photos={intel.photos} /></div>
          </div>
        )}
      </div>
      <NavigationPanel ui={navUi.ui} />
      <OutboxStatus outbox={visits.outbox} floating />
      <LiveArrival live={live} vehicle={vehicle} tripId={trip.id} mark={visits.mark} failed={visits.failed} onClearFailed={visits.clearFailed} onPrompt={onArrivalPrompt} />
      <UndoToast undo={actions.undo} busy={actions.replanning} onUndo={() => void actions.runUndo().then(() => intel.refresh())} onDismiss={actions.dismissUndo} />
    </main>
  );
}