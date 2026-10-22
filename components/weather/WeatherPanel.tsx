"use client";

// "Weather on your way": where you are now, plus the coming stops, each at the time you will be there; the alerts that matter, sorted;
// one Now / At arrival / Pick a time choice for every place. It refreshes by itself (lib/client/use-weather-board.ts); while it does,
// the last good numbers stay; placeholders keep every card's size; over 60 minutes old, nothing is shown.
import Link from "next/link";
import { useState } from "react";
import type { WeatherBoard } from "@/lib/client/use-weather-board";
import type { DeviceHere } from "@/lib/client/use-device-here";
import { forecastHorizonMs } from "@/lib/forecast/areas";
import type { ViewMode } from "@/lib/forecast/view-time";
import { INDIA_UTC_OFFSET_MIN, time12 } from "@/lib/travel/clock";
import { Glyph } from "@/components/ui/Glyph";
import { PlaceWeatherCard, PlaceWeatherCardSkeleton, WeatherAlertRow } from "./WeatherParts";
import { ViewModeSwitch } from "./ViewModeSwitch";

export type WeatherPanelProps = {
  board: WeatherBoard;
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  nowMs: number;
  /** Where "here" comes from; with "planned"/"none" the panel offers "Show weather where I am". */
  hereSource: "drive" | "device" | "planned" | "none";
  device?: DeviceHere;
  requestDevice?: () => void;
  /** Show this many stops, then "Show all". Undefined: all. */
  limit?: number;
  /** The trip's Weather page (every stop), or undefined on that page itself. */
  allStopsHref?: string;
  onSetDates?: () => void;
  title?: string;
  /** Grouping: a heading before the stop with this id ("Day 2 · Fri 23 Oct"). */
  headings?: Record<string, string>;
  /** How many cards to hold space for before the board has any (first paint): placeholders of the same size, so nothing jumps. */
  placeholders?: number;
};

const ALERTS_OPEN = 3;

function StatusLine({ board, nowMs }: { board: WeatherBoard; nowMs: number }) {
  const age = board.fetchedAt !== null ? Math.max(0, Math.floor((nowMs - board.fetchedAt) / 60_000)) : null;
  const text =
    board.status === "loading" ? "Getting the forecast…"
    : board.problem === "offline" ? (board.fetchedAt !== null ? `Offline · forecast from ${time12(board.fetchedAt, INDIA_UTC_OFFSET_MIN)}` : "Offline: weather unavailable right now")
    : board.problem === "error" ? "Couldn't update the weather. Trying again by itself."
    : board.problem === "limited" ? "Weather has been checked very often today. It will update again later."
    : board.problem === "signed-out" ? "Sign in again to update the weather."
    : age === null ? "" : age < 1 ? "Updated just now" : `Updated ${age} min ago`;
  return (
    <p className="flex min-h-5 items-center gap-1.5 text-xs text-ink-muted" role="status">
      {text}{board.refreshing && board.status !== "loading" ? <span className="font-semibold"> · Updating…</span> : null}
    </p>
  );
}

export function WeatherPanel(p: WeatherPanelProps) {
  const { board, nowMs } = p;
  const [allAlerts, setAllAlerts] = useState(false);
  const [allStops, setAllStops] = useState(false);
  const here = board.places.find((x) => x.role === "here") ?? null;
  const stops = board.places.filter((x) => x.role === "stop");
  const shown = p.limit !== undefined && !allStops ? stops.slice(0, p.limit) : stops;
  const alertsFor = (id: string) => board.alerts.filter((a) => a.placeId === id);
  const loading = board.status === "loading";
  const notYet = board.status === "idle" && board.places.length === 0 && (p.placeholders ?? 0) > 0;
  const horizon = forecastHorizonMs(nowMs);
  const outlook = here?.outlook?.status === "ok" ? here.outlook.text : null;
  const asking = p.device?.status === "asking";

  return (
    <section aria-labelledby="wx-panel-heading" className="space-y-3 rounded-2xl border border-line bg-white p-3.5 sm:p-5">
      <div>
        <h2 id="wx-panel-heading" className="font-display text-lg font-semibold text-pine">{p.title ?? "Weather on your way"}</h2>
        <StatusLine board={board} nowMs={nowMs} />
      </div>
      {/* Rest of today, then one tip only when it helps. Space is kept while loading so nothing jumps. */}
      <div className="min-h-6 space-y-1">
        {board.today ? (
          <p className="text-sm font-semibold text-pine" data-testid="rest-of-today"><span className="font-normal text-ink-muted">Rest of today{board.today.place ? ` · ${board.today.place}` : ""}: </span>{board.today.text}</p>
        ) : loading ? <p className="h-5 w-2/3 rounded bg-sky" aria-hidden="true" /> : null}
        {board.tip && <p className="flex items-start gap-1.5 rounded-xl bg-marigold-light px-3 py-2 text-sm text-[#7a4a00]" data-testid="weather-tip"><Glyph name="idea" size={16} className="mt-0.5 shrink-0" /><span><strong>Tip:</strong> {board.tip}</span></p>}
      </div>
      <ViewModeSwitch mode={p.mode} setMode={p.setMode} nowMs={nowMs} horizonEnd={horizon} />

      {board.alerts.length > 0 && (
        <div>
          <h3 className="sr-only">Weather alerts</h3>
          <ul className="space-y-1.5">{(allAlerts ? board.alerts : board.alerts.slice(0, ALERTS_OPEN)).map((a) => <WeatherAlertRow key={a.id} a={a} />)}</ul>
          {board.alerts.length > ALERTS_OPEN && (
            <button type="button" onClick={() => setAllAlerts((v) => !v)} className="mt-1 min-h-11 text-sm font-semibold text-teal-ink">{allAlerts ? "Show fewer alerts" : `Show ${board.alerts.length - ALERTS_OPEN} more alerts`}</button>
          )}
        </div>
      )}

      {(here || p.hereSource === "none") && (
        <div className="space-y-1.5">
          {here ? (loading ? <PlaceWeatherCardSkeleton /> : <PlaceWeatherCard place={here} alerts={alertsFor("here")} nowMs={nowMs} />) : null}
          {outlook && !loading && <p className="flex items-center gap-1.5 px-1 text-sm font-semibold text-pine"><Glyph name="rain" size={15} />{outlook}</p>}
          {(p.hereSource === "planned" || p.hereSource === "none") && p.requestDevice && (
            <div className="px-1">
              <button type="button" onClick={p.requestDevice} disabled={asking} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-teal px-4 text-sm font-semibold text-teal-ink disabled:opacity-60">
                <Glyph name="locate" size={16} />{asking ? "Finding you…" : "Show weather where I am"}
              </button>
              {p.device?.status === "denied" && <p className="mt-1 text-xs text-ink-muted">Location is blocked for this site. Allow it in your browser&apos;s site settings to see the weather where you are.</p>}
              {p.device?.status === "unavailable" && <p className="mt-1 text-xs text-ink-muted">Your position isn&apos;t available right now. Try again in the open.</p>}
            </div>
          )}
        </div>
      )}

      {notYet && <div className="space-y-2">{Array.from({ length: p.placeholders! }, (_, i) => <PlaceWeatherCardSkeleton key={i} />)}</div>}
      {shown.length > 0 && (
        <div className="space-y-2">
          {shown.map((s) => (
            <div key={s.id} className="space-y-1.5">
              {p.headings?.[s.id] && <h3 className="px-1 pt-1 font-display text-base font-semibold text-pine">{p.headings[s.id]}</h3>}
              {loading ? <PlaceWeatherCardSkeleton /> : <PlaceWeatherCard place={s} alerts={alertsFor(s.id)} nowMs={nowMs} onSetDates={p.onSetDates} />}
            </div>
          ))}
          {p.limit !== undefined && stops.length > p.limit && (
            <button type="button" onClick={() => setAllStops((v) => !v)} className="min-h-11 text-sm font-semibold text-teal-ink">{allStops ? "Show fewer stops" : `Show all ${stops.length} stops`}</button>
          )}
        </div>
      )}
      {!loading && !notYet && !here && stops.length === 0 && <p className="text-sm text-ink-muted">No coming stops to show the weather for.</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <p className="text-[11px] text-ink-muted">Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Open-Meteo.com<span className="sr-only"> (opens in a new tab)</span></a>. Times are India time.</p>
        {p.allStopsHref && <Link href={p.allStopsHref} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-teal-ink">Every stop on the trip<Glyph name="arrow" size={14} /></Link>}
      </div>
    </section>
  );
}
