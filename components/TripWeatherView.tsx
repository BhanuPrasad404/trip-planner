"use client";

// The trip's Weather page: EVERY stop on the trip, each at the time you will be there (the live ETA while driving, else the planned
// time), grouped by day; where you are (or the planned start, said as such); the alerts for all of them; one Now / At arrival / Pick a
// time choice. Stops more than 16 days away show the season's typical numbers; unscheduled ideas are listed with no numbers.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useEngine } from "@/components/drive/DriveProvider";
import { useWeatherBoard } from "@/lib/client/use-weather-board";
import { useDeviceHere } from "@/lib/client/use-device-here";
import { useNowMinute } from "@/lib/client/use-now";
import { tripDayISO } from "@/lib/forecast/ist";
import { DEFAULT_VIEW, plannedInstant, typicalView, type ViewMode } from "@/lib/forecast/view-time";
import type { BoardStop } from "@/lib/forecast/board";
import type { PlaceWithSeason, Trip } from "@/lib/types";
import type { Conditions } from "@/lib/weather";
import { WeatherPanel } from "./weather/WeatherPanel";
import { Glyph } from "./ui/Glyph";

type Props = { trip: Trip; places: PlaceWithSeason[]; conditions: Record<string, Conditions> };

const dayHeading = (day: number, iso: string | null) =>
  `Day ${day}${iso ? ` · ${new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}` : ""}`;

export function TripWeatherView({ trip, places, conditions }: Props) {
  const router = useRouter();
  const nowMinute = useNowMinute();
  const nowMs = nowMinute ? nowMinute * 60_000 : 0;
  const engine = useEngine(trip.id); // present while this trip is being driven (or its map/live page is open)
  const driving = !!engine?.live.drive.active && !!engine.live.drive.me;
  const { here: device, request } = useDeviceHere();
  const [mode, setMode] = useState<ViewMode>(DEFAULT_VIEW);

  const scheduled = useMemo(
    () => places.filter((p) => p.day_number !== null && (p.status ?? "planned") === "planned").sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0) || (a.sequence_order ?? 0) - (b.sequence_order ?? 0)),
    [places],
  );
  const finished = places.filter((p) => p.day_number !== null && (p.status === "done" || p.status === "skipped")).length;
  const ideas = places.filter((p) => p.day_number === null);
  const etas = engine?.weather.etas;

  const stops = useMemo<BoardStop[]>(() => scheduled.map((p, i) => {
    const dayISO = tripDayISO(trip.start_date, p.day_number);
    return { id: p.id, name: p.name, lat: p.lat, lng: p.lng, isNext: i === 0, liveEta: driving ? etas?.get(p.id) ?? null : null, planned: plannedInstant(dayISO, p.arrival_time ?? null), dayISO, typical: typicalView(conditions[p.id]) };
  }), [scheduled, trip.start_date, conditions, driving, etas]);

  const me = engine?.live.drive.me;
  const hereSource = driving ? "drive" : device.status === "on" ? "device" : trip.start_lat != null && trip.start_lng != null ? "planned" : "none";
  const here =
    hereSource === "drive" && me ? { lat: me.lat, lng: me.lng, label: "Where you are" }
    : hereSource === "device" && device.status === "on" ? { lat: device.lat, lng: device.lng, label: "Where you are" }
    : hereSource === "planned" ? { lat: trip.start_lat!, lng: trip.start_lng!, label: trip.start_city ?? "Your start", note: "Planned start, not your live location" }
    : null;
  const board = useWeatherBoard({ enabled: nowMs > 0, nowMs, mode, here, stops, road: [] });

  const headings = useMemo(() => {
    const out: Record<string, string> = {};
    let last: number | null = null;
    for (const p of scheduled) { if (p.day_number !== last) out[p.id] = dayHeading(p.day_number!, tripDayISO(trip.start_date, p.day_number)); last = p.day_number; }
    return out;
  }, [scheduled, trip.start_date]);
  const datesHref = `/trips/${trip.id}/plan?tool=dates`;

  return (
    <main id="main" className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 sm:px-6">
      {!trip.start_date && scheduled.length > 0 && (
        <Link href={datesHref} className="flex min-h-11 items-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-teal-ink">
          <Glyph name="calendar" size={18} />No trip date set: add dates to see the weather at your arrival times
        </Link>
      )}
      <WeatherPanel
        title="Weather for every stop"
        board={board} mode={mode} setMode={setMode} nowMs={nowMs} placeholders={scheduled.length + (here ? 1 : 0)}
        hereSource={hereSource} device={device} requestDevice={request}
        headings={headings} onSetDates={() => router.push(datesHref)}
      />
      {finished > 0 && <p className="px-1 text-sm text-ink-muted">{finished} {finished === 1 ? "stop is" : "stops are"} done or skipped, so not shown here.</p>}
      {ideas.length > 0 && (
        <section aria-labelledby="wx-ideas" className="rounded-2xl border border-line bg-white p-4">
          <h2 id="wx-ideas" className="font-display text-base font-semibold text-pine">Not in the plan yet</h2>
          <p className="mt-0.5 text-sm text-ink-muted">Add a place to a day to see its weather when you will be there.</p>
          <ul className="mt-2 divide-y divide-line">{ideas.map((p) => <li key={p.id} className="py-2 text-sm text-ink">{p.name}</li>)}</ul>
        </section>
      )}
    </main>
  );
}
