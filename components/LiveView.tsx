"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { enrichPlaces } from "@/lib/client/enrich";
import { useTripActions } from "@/lib/client/use-trip-actions";
import { useTripLive } from "@/lib/client/use-trip-live";
import { formatDistance } from "@/lib/live";
import { delayText } from "@/lib/live";
import { googleMapsDirections } from "@/lib/maps-links";
import type { Advice, RadarItem } from "@/lib/intel/types";
import type { PlaceWithSeason, Trip, TripMember } from "@/lib/types";
import type { VoteSummary } from "@/lib/votes";
import type { Conditions } from "@/lib/weather";
import { DrivePanel } from "./DrivePanel";
import { DriveGateCard } from "./DriveGateCard";
import { NavigationBanner, NavigationPanel } from "./map/NavigationOverlay";
import { useNavUi } from "@/lib/client/use-nav-ui";
import { NearbyPanel } from "./NearbyPanel";
import { AheadBrowser } from "./intel/AheadBrowser";
import { AutopilotCard } from "./intel/AutopilotCard";
import { NextBestAction } from "./intel/NextBestAction";
import { PulseCard } from "./intel/PulseCard";
import { RadarList } from "./intel/RadarList";
import { TripHealthStrip } from "./intel/TripHealthStrip";
import { UndoToast } from "./intel/UndoToast";
import { WeatherSunCard } from "./intel/WeatherSunCard";
import { TripMapLazy } from "./TripMapLazy";
import { FormError } from "./ui/Field";
import { Glyph } from "@/components/ui/Glyph";
import { dayWithDate } from "@/lib/time-context";
import { useMapTheme } from "@/lib/client/use-map-theme";

type Props = { trip: Trip; places: PlaceWithSeason[]; members: TripMember[]; votes: Record<string, VoteSummary>; conditions: Record<string, Conditions>; userId: string; today: string };

export function LiveView({ trip, places, members, votes, conditions, userId, today }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());
  const firstDay = places.find((p) => p.day_number !== null)?.day_number ?? 1;
  const [focusDay, setFocusDay] = useState(firstDay);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [follow, setFollow] = useState(true);
  const [mapTheme] = useMapTheme();
  const [replanNote, setReplanNote] = useState<{ text: string; warnings: string[] } | null>(null);

  const enriched = useMemo(() => enrichPlaces(places, trip, today, conditions), [places, trip, today, conditions]);
  const live = useTripLive({ trip, places, members, userId, enriched, votes, focusDay });
  const actions = useTripActions({ tripId: trip.id, places, onChanged: refresh, localDate: live.localDate, localTime: live.localTime, earlyDay: live.drive.active && live.timing?.state === "before" ? live.driveDay : null });
  const { drive, intel, nextStop, driveDay, todayDay } = live;
  const navUi = useNavUi(live, follow, setFollow, (id, name) => void actions.setStatus(id, "done", `Marked ${name} done`));

  const result = intel.result;
  const advice = (result?.advice ?? []).filter((a) => !dismissed.has(a.id));
  const mapping = !!intel.coverage && intel.coverage.ready < intel.coverage.total && intel.coverage.failed === 0;
  const busy = actions.replanning || actions.busyId !== null;
  const byId = new Map(places.map((p) => [p.id, p]));

  async function accept(a: Advice, optionKey?: string) {
    const act = a.action;
    if (!act) return;
    if (act.type === "replan") {
      const note = await actions.replanFromNow();
      if (note) setReplanNote(note);
    } else if (act.type === "skip") {
      await actions.setStatus(act.stopId, "skipped", `Skipped ${byId.get(act.stopId)?.name ?? "a stop"}`);
    } else if (act.type === "move_next_day") {
      await actions.moveToDay(act.stopId, driveDay + 1, `Moved ${byId.get(act.stopId)?.name ?? "a stop"} to Day ${driveDay + 1}`);
    } else if (act.type === "insert_stop") {
      const o = a.options?.find((x) => x.key === (optionKey ?? act.key));
      if (o) await actions.insertStop({ name: o.name, lat: o.lat, lng: o.lng, category: o.kind === "viewpoint" ? "viewpoint" : o.kind === "sight" ? "other" : null }, driveDay);
    }
    intel.refresh();
  }
  const keep = (a: Advice) => setDismissed((s) => new Set(s).add(a.id));
  const addRadar = (r: RadarItem) => actions.insertStop({ name: r.name, lat: r.lat, lng: r.lng, category: r.kind === "viewpoint" ? "viewpoint" : null }, driveDay);

  // What to say when there is nothing urgent.
  const firstLeg = drive.route && nextStop && drive.route.stopIds[0] === nextStop.id ? drive.route.legs[0] : null;
  const fallback = nextStop
    ? {
        title: drive.active ? `Head to ${nextStop.name}` : `Next: ${nextStop.name}`,
        detail: firstLeg
          ? `${formatDistance(firstLeg.km)} · about ${firstLeg.minutes} min${nextStop.arrival_time ? ` · planned ${nextStop.arrival_time.slice(0, 5)}` : ""}. You're on track — nothing needs your attention.`
          : `${nextStop.arrival_time ? `Planned for ${nextStop.arrival_time.slice(0, 5)}. ` : ""}${drive.active ? "Working out the route…" : "Start your drive to see distance, arrival time and what's ahead."}`,
        navigateTo: { lat: nextStop.lat, lng: nextStop.lng },
        action: drive.active ? null : ("start-drive" as const),
      }
    : live.done > 0
      ? { title: "That's everything for today", detail: `${live.done} stop${live.done === 1 ? "" : "s"} done. Rest well — tomorrow's plan is ready.`, navigateTo: null, action: null }
      : { title: `Nothing planned for Day ${driveDay}`, detail: "Add or schedule a stop and this page starts helping.", navigateTo: null, action: "plan" as const, href: `/trips/${trip.id}/plan` };

  const mapPlaces = useMemo(() => places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, day: p.day_number, order: p.sequence_order })), [places]);
  const start = useMemo(() => (trip.start_lat != null && trip.start_lng != null ? { lat: trip.start_lat, lng: trip.start_lng, label: trip.start_city ?? "Start" } : null), [trip.start_lat, trip.start_lng, trip.start_city]);
  const dest = useMemo(() => (trip.dest_lat != null && trip.dest_lng != null ? { lat: trip.dest_lat, lng: trip.dest_lng, label: trip.dest_name ?? "Destination" } : null), [trip.dest_lat, trip.dest_lng, trip.dest_name]);
  const days = Array.from({ length: trip.num_days }, (_, i) => i + 1);

  return (
    <main id="main" className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
      {todayDay === null && (
        <p className="rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-muted">
          <strong className="text-pine">This trip isn&apos;t happening today</strong>, so this is a preview of Day {driveDay} from {live.previewFrom?.label ?? "the start"}.{" "}
          <span className="inline-flex flex-wrap gap-1 align-middle">
            {days.map((d) => <button key={d} type="button" onClick={() => setFocusDay(d)} aria-pressed={d === focusDay} className={`min-h-8 rounded-full px-3 text-xs font-semibold ${d === focusDay ? "bg-pine text-white" : "bg-sky text-pine"}`}>Day {d}</button>)}
          </span>
        </p>
      )}

      <DriveGateCard drive={drive} gate={live.gate} />
      <NextBestAction advice={advice[0] ?? null} busy={busy} onAccept={(a) => void accept(a)} onKeep={keep} fallback={fallback} onStartDrive={drive.start} />
      <TripHealthStrip health={result?.health ?? null} />
      {intel.mode === "preview" && result && live.localDate && live.localTime && (
        <p role="note" className="flex items-start gap-2 rounded-xl bg-sky px-3 py-2 text-sm text-ink-muted">
          <Glyph name="info" size={16} className="mt-0.5 shrink-0 text-pine" />
          <span><strong className="text-pine">Preview.</strong> Times and advice here assume you set off from {live.previewFrom?.label ?? "your start"} right now ({dayWithDate(live.localDate, live.localDate)}, {live.localTime}). Start your drive to use your real position.</span>
        </p>
      )}
      {result && <WeatherSunCard weather={result.weatherNow} sun={result.sun} sunNext={result.sunNext} where={live.liveOk ? "your location" : live.previewFrom?.label ?? "the start"} updatedAt={intel.updatedAt} nowMs={live.nowMs} tripNote={live.weatherNote} />}

      <div aria-live="polite" className="space-y-2 empty:hidden">
        <FormError message={actions.error ?? intel.error} />
        {actions.notice && <p role="status" className="rounded-xl border border-teal/30 bg-teal-light px-4 py-3 text-sm font-medium text-teal-ink">{actions.notice}</p>}
        {replanNote && (
          <div role="status" className="rounded-xl border border-line bg-white px-4 py-3 text-sm">
            <p className="font-semibold text-pine">{replanNote.text}</p>
            {replanNote.warnings.length > 0 && <ul className="mt-1 space-y-1 text-clay-ink">{replanNote.warnings.map((w) => <li key={w} className="flex items-start gap-1.5"><Glyph name="warn" size={14} className="mt-0.5" />{w}</li>)}</ul>}
          </div>
        )}
        {intel.notes.map((n) => <p key={n} className="text-xs text-ink-muted">ℹ {n}</p>)}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-5">
          <div className="relative h-[52vh] min-h-[22rem] overflow-hidden rounded-3xl border border-line bg-white shadow-sm lg:h-[62vh]">
            <TripMapLazy theme={mapTheme} places={mapPlaces} start={start} destination={dest} activeDay={driveDay} fit="day" frameStartDest={false} live={live.liveMarkers} pois={live.poiMarkers} driveLine={drive.active && !navUi.navBusy ? drive.route?.line ?? null : null} nav={navUi.nav} headingUp={navUi.headingUp} viewRequest={navUi.viewRequest} recenter={navUi.recenter} onCompass={navUi.onCompass} onSelectRoute={live.navigation.choose} follow={drive.active && follow} onUserPan={() => setFollow(false)} />
            <NavigationBanner ui={navUi.ui} />
            <Link href={`/trips/${trip.id}/map`} className="absolute left-3 top-3 min-h-10 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-pine shadow">Full-screen map</Link>
            {drive.active && !follow && <button type="button" onClick={navUi.ui.onRecenter} className="absolute bottom-3 left-3 min-h-10 rounded-full border border-line bg-white px-4 text-sm font-semibold text-pine shadow"><span className="inline-flex items-center gap-1.5"><Glyph name="locate" size={16} />Follow me</span></button>}
          </div>
          <NavigationPanel ui={navUi.ui} floating={false} />
          <DrivePanel drive={drive} members={members} userId={userId} stops={live.driveStops} stayMinutes={live.stayMinutes} comparePlan={todayDay !== null && driveDay === todayDay} dayLabel={`Day ${driveDay}`} nowMs={live.nowMs} />
        </div>

        <div className="space-y-5">
          <section aria-labelledby="upnext-heading" className="rounded-2xl border border-line bg-white p-4 sm:p-5">
            <h2 id="upnext-heading" className="font-display text-lg font-semibold text-pine">Up next</h2>
            {live.remaining.length === 0 ? <p className="mt-2 text-sm text-ink-muted">Nothing left on Day {driveDay}.</p> : (
              <ol className="mt-1 divide-y divide-line">
                {live.remaining.map((p) => {
                  const eta = result?.stopEtas.find((e) => e.id === p.id);
                  const d = delayText(eta?.delayMin ?? null);
                  return (
                    <li key={p.id} className="py-3 text-sm">
                      <div className="flex items-start gap-3">
                        <span className="w-12 shrink-0 font-mono text-xs text-ink-muted">{p.arrival_time?.slice(0, 5) ?? "--:--"}</span>
                        <div className="min-w-0 flex-1">
                          <p className="break-words font-semibold text-pine">{p.name}</p>
                          {eta && <p className="text-xs text-ink-muted">You&apos;d arrive about <strong>{eta.etaClock}</strong>{d && <span className={`ml-2 rounded-full px-2 py-0.5 font-semibold ${d.tone === "late" ? "bg-clay-light text-clay-ink" : d.tone === "ok" ? "bg-teal-light text-teal-ink" : "bg-sky text-ink-muted"}`}>{d.text}</span>}</p>}
                          <div className="mt-1 flex flex-wrap items-center gap-x-4">
                            <a href={googleMapsDirections(p)} target="_blank" rel="noopener noreferrer" className="min-h-9 py-1.5 font-semibold text-teal-ink underline underline-offset-2">Navigate<span className="sr-only"> to {p.name} in Google Maps (opens in a new tab)</span></a>
                            <button type="button" disabled={busy} onClick={() => void actions.setStatus(p.id, "done", `Marked ${p.name} done`)} className="min-h-9 py-1.5 font-semibold text-pine underline underline-offset-2 disabled:opacity-60"><span className="inline-flex items-center gap-1.5"><Glyph name="check" size={16} />Done</span></button>
                            <button type="button" disabled={busy} onClick={() => void actions.setStatus(p.id, "skipped", `Skipped ${p.name}`)} className="min-h-9 py-1.5 text-ink-muted underline underline-offset-2 disabled:opacity-60">Skip</button>
                          </div>
                          <PulseCard name={p.name} lat={p.lat} lng={p.lng} showTravelerPhotos />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <RadarList radar={result?.radar ?? []} photos={intel.photos} mapping={mapping} trafficConnected={false} onAdd={live.remaining.length > 0 || drive.active ? addRadar : undefined} busy={busy} />

          <AheadBrowser aheadByKind={result?.aheadByKind ?? {}} photos={intel.photos} />

          {advice.length > 1 && (
            <section aria-labelledby="auto-heading">
              <h2 id="auto-heading" className="mb-2 font-display text-lg font-semibold text-pine">More from Autopilot</h2>
              <ul className="space-y-3">{advice.slice(1, 5).map((a) => <AutopilotCard key={a.id} advice={a} photos={intel.photos} busy={busy} onAccept={(x, k) => void accept(x, k)} onKeep={keep} />)}</ul>
            </section>
          )}

          <details className="rounded-2xl border border-line bg-white p-4 sm:p-5">
            <summary className="cursor-pointer font-display text-lg font-semibold text-pine">Search nearby</summary>
            <div className="mt-3"><NearbyPanel anchor={nextStop ? { lat: nextStop.lat, lng: nextStop.lng, label: nextStop.name } : live.previewFrom} /></div>
          </details>
        </div>
      </div>

      <UndoToast undo={actions.undo} busy={actions.replanning} onUndo={() => void actions.runUndo().then(() => intel.refresh())} onDismiss={actions.dismissUndo} />
    </main>
  );
}
