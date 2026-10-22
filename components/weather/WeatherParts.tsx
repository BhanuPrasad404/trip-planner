// The weather building blocks every screen uses (Plan, Live, Map, the trip's Weather page). Calm and glanceable:
//   • the time the traveller will be there is the main text; the forecast step is small and secondary
//   • severity is always an icon AND a word (Watch, Warning, Severe), never colour alone
//   • a card keeps the same size while loading (its placeholder has the same shape), so nothing jumps
// All wording comes from lib/forecast/present.ts; every number comes from the forecast for that place at that moment.
import { useState } from "react";
import type { BoardPlace } from "@/lib/forecast/board";
import type { WeatherAlert } from "@/lib/forecast/alerts";
import type { DayPart } from "@/lib/forecast/day-parts";
import type { NextHour } from "@/lib/forecast/coming";
import type { GlyphName } from "@/lib/glyphs";
import { KIND_ICON, SEVERITY_ICON, alertHeadline, dayNightWord, heatWord, missingText, momentIcon, partSummary, rainText, severityWord, stepText, timeText } from "@/lib/forecast/present";
import { sunTimes } from "@/lib/intel/sun";
import { INDIA_UTC_OFFSET_MIN, clock12, time12 } from "@/lib/travel/clock";
import type { Severity } from "@/lib/weather-rules";
import { Glyph } from "@/components/ui/Glyph";
import { Skeleton } from "@/components/ui/Skeleton";

const LEVEL_STYLE: Record<Severity, string> = {
  watch: "border-line bg-sky text-pine",
  warning: "border-marigold bg-marigold-light text-[#7a4a00]",
  severe: "border-clay bg-clay-light text-clay-ink",
};

/** "⚠ Warning": icon and word together. */
export function SeverityBadge({ level }: { level: Severity }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${LEVEL_STYLE[level]}`}>
      <Glyph name={SEVERITY_ICON[level]} size={13} strokeWidth={2.4} />{severityWord(level)}
    </span>
  );
}

/** One alert: how bad, what and where and when, what to do, and where it comes from. */
export function WeatherAlertRow({ a }: { a: WeatherAlert }) {
  return (
    <li data-alert={a.kind} data-level={a.level} className={`rounded-xl border px-3 py-2.5 ${LEVEL_STYLE[a.level]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge level={a.level} />
        <span className="text-xs font-semibold">{a.when}</span>
      </div>
      <p className="mt-1 flex items-start gap-1.5 text-sm font-semibold text-ink">
        <Glyph name={KIND_ICON[a.kind]} size={16} className="mt-0.5" />
        <span>{alertHeadline(a)}{a.detail ? <span className="font-normal text-ink-soft"> · {a.detail}</span> : null}</span>
      </p>
      {a.advice && <p className="mt-1 text-sm text-ink">{a.advice}</p>}
      <p className="mt-1 text-[11px] text-ink-muted">{a.source} forecast for {time12(a.forecastFor, INDIA_UTC_OFFSET_MIN)}</p>
    </li>
  );
}

/** Morning, afternoon, evening, night: the part the traveller will be there is outlined and says so; past parts say "Earlier". */
export function DayStrip({ parts, highlight, label }: { parts: DayPart[] | null; highlight: BoardPlace["highlight"]; label: string }) {
  if (!parts) return <div className="h-[4.25rem] rounded-xl bg-sky/60" aria-hidden="true" />;
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label={label}>
      {parts.map((p) => {
        const s = partSummary(p);
        const mine = highlight === p.id;
        return (
          <li key={p.id} className={`flex min-h-[4.25rem] flex-col items-center justify-center rounded-xl px-1 py-1.5 text-center ${mine ? "border-2 border-pine bg-white" : "border border-line bg-sky/60"} ${p.past ? "opacity-55" : ""}`}>
            <span className="text-[11px] font-semibold text-ink-muted">{p.label}</span>
            {s.icon && <Glyph name={s.icon} size={16} className={s.icon === "moon" ? "text-ink-muted" : "text-pine"} />}
            <span className="text-xs font-semibold leading-tight text-pine">{p.past ? "Earlier" : s.word}</span>
            {!p.past && (s.rain || s.feels) && <span className="text-[11px] leading-tight text-ink-muted">{[s.rain ? `${s.rain} rain` : null, s.feels].filter(Boolean).join(" · ")}</span>}
            {mine && <span className="sr-only"> (you will be there then)</span>}
            {p.coverage === "partial" && !p.past && <span className="text-[10px] text-ink-muted">part forecast</span>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The next 12 hours in a row: the hour, sun or moon at that place then (rain when it is likely), the temperature, and the rain chance
 * as a bar AND a number (never colour alone). The arrival hour is outlined and says so. Scrolls sideways on a small phone.
 */
export function NextHoursRow({ hours, label }: { hours: NextHour[]; label: string }) {
  if (hours.length === 0) return <p className="mt-2 text-sm text-ink-muted">No hourly forecast for this place right now.</p>;
  return (
    <ol aria-label={label} className="mt-2 flex gap-1.5 overflow-x-auto pb-1" data-testid="next-hours">
      {hours.map((h) => {
        const pct = h.precipProb !== null ? Math.max(0, Math.min(100, Math.round(h.precipProb))) : null;
        const icon: GlyphName | null = pct !== null && pct >= 60 ? "rain" : h.isDay === true ? "sun" : h.isDay === false ? "moon" : null;
        const clock = time12(h.time, INDIA_UTC_OFFSET_MIN);
        return (
          <li key={h.time} className={`flex w-14 shrink-0 flex-col items-center rounded-xl px-1 py-1.5 text-center ${h.isArrival ? "border-2 border-pine bg-white" : "border border-line bg-sky/50"}`}>
            <span className="text-[11px] font-semibold text-ink-muted">{clock.replace(" AM", "a").replace(" PM", "p")}</span>
            <span className="h-5">{icon && <Glyph name={icon} size={16} className={icon === "moon" ? "text-ink-muted" : "text-pine"} />}</span>
            <span className="text-sm font-semibold text-pine">{h.tempC !== null ? `${Math.round(h.tempC)}°` : "–"}</span>
            <span aria-hidden="true" className="mt-1 flex h-8 w-3 items-end overflow-hidden rounded-full bg-line/60"><span className="w-full rounded-full bg-teal" style={{ height: `${pct ?? 0}%` }} /></span>
            <span className="text-[11px] text-ink-muted">{pct !== null ? `${pct}%` : "–"}</span>
            {h.isArrival && <span className="text-[10px] font-bold uppercase text-pine">Arrive</span>}
            <span className="sr-only">{`${clock}: ${h.tempC !== null ? `${Math.round(h.tempC)} degrees` : "no temperature"}, ${pct !== null ? `${pct}% chance of rain` : "rain chance not given"}, ${h.isDay === false ? "night" : h.isDay ? "day" : ""}${h.isArrival ? ", when you arrive" : ""}`}</span>
          </li>
        );
      })}
    </ol>
  );
}

const ROLE_LABEL = (p: BoardPlace) => (p.role === "here" ? "Where you are" : p.isNext ? "Next stop" : "Stop");

/**
 * One place: when you will be there (main), the temperature and feels-like, day or night there, the rain chance, the day strip, and any
 * alert for it. Tap the card for the next 12 hours (a stop: around its arrival hour), the hour's rain window, gusts, visibility and
 * sunset. Every state keeps the card's size.
 */
export function PlaceWeatherCard({ place, alerts, nowMs, onSetDates }: { place: BoardPlace; alerts: WeatherAlert[]; nowMs: number; onSetDates?: () => void }) {
  const [open, setOpen] = useState(false);
  const m = place.moment;
  const ok = m?.status === "ok" ? m : null;
  const title = place.name, note = place.note;
  const icon = ok ? momentIcon(ok) : null;
  const hot = ok ? heatWord(ok) : null;
  const sun = place.timing.status === "time" ? sunTimes(place.lat, place.lng, place.timing.at, INDIA_UTC_OFFSET_MIN) : null;
  const noDates = place.timing.status === "no-time" && place.dayISO === null && place.role === "stop";
  const canOpen = !!ok || place.next.length > 0;
  const head = (
    <span className="flex items-start justify-between gap-3">
      <span className="block min-w-0">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-ink-muted">{ROLE_LABEL(place)} · <span className="normal-case tracking-normal">{title}</span></span>
        {note && <span className="block text-xs font-semibold text-clay-ink">{note}</span>}
        <span className="mt-0.5 block font-display text-lg font-semibold leading-tight text-pine" data-testid="time-text">{noDates ? "No trip date set" : timeText(place, nowMs)}</span>
        {ok && <span className="mt-0.5 block text-sm text-ink">{[dayNightWord(ok.isDay), ok.condition, rainText(ok)].filter(Boolean).join(" · ")}</span>}
      </span>
      {ok && ok.tempC !== null && (
        <span className="block shrink-0 text-right">
          <span className="flex items-center justify-end gap-1.5 font-display text-3xl font-semibold leading-none text-pine">
            {icon && <Glyph name={icon} size={24} className={icon === "moon" || icon === "cloudMoon" ? "text-ink-muted" : "text-marigold"} />}
            {Math.round(ok.tempC)}°
          </span>
          {ok.feelsC !== null && <span className="mt-1 block text-xs font-semibold text-ink-muted">feels {Math.round(ok.feelsC)}°</span>}
          {hot && <span className="mt-0.5 block text-xs font-bold text-clay-ink">{hot}</span>}
        </span>
      )}
    </span>
  );
  return (
    <article data-place={place.id} aria-label={`Weather for ${title}`} className="min-h-[11.5rem] rounded-2xl border border-line bg-white p-3.5 sm:p-4">
      {canOpen ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="block w-full text-left" data-testid="card-toggle">
          {head}
          <span className="sr-only">{open ? "Hide the next 12 hours" : "Show the next 12 hours"}</span>
        </button>
      ) : head}

      {ok && <p className="mt-1 text-[11px] text-ink-muted">{stepText(ok)} · Open-Meteo</p>}
      {m && m.status !== "ok" && <p className="mt-1 text-sm text-ink-muted">{missingText(m, place.typical?.text ?? null)}</p>}
      {noDates && onSetDates && (
        <button type="button" onClick={onSetDates} className="mt-1 min-h-11 text-left text-sm font-semibold text-teal-ink underline underline-offset-2">
          No trip date set: add dates to see the weather at your arrival times
        </button>
      )}
      {!noDates && place.timing.status === "no-time" && <p className="mt-1 text-sm text-ink-muted">Set an arrival time to see the weather then. The day at this place:</p>}

      {alerts.length > 0 && <ul className="mt-2 space-y-1.5">{alerts.map((a) => <WeatherAlertRow key={a.id} a={a} />)}</ul>}

      {place.role !== "road" && !noDates && (place.parts || place.timing.status === "time") && !(m && m.status === "beyond-forecast") && (
        <div className="mt-2.5"><DayStrip parts={place.parts} highlight={place.highlight} label={`${title}: morning, afternoon, evening and night`} /></div>
      )}

      {canOpen && (
        <>
          <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => setOpen((v) => !v)} className="mt-1.5 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-teal-ink">
            {open ? "Hide next 12 hours" : "Next 12 hours"}<Glyph name={open ? "up" : "down"} size={14} />
          </button>
          {open && <NextHoursRow hours={place.next} label={`${title}: the next 12 hours`} />}
          {open && ok && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-sky/60 px-3 py-2 text-sm">
              {ok.rainFrom !== null && ok.rainTo !== null && <><dt className="text-ink-muted">Rain</dt><dd>{rainText(ok) ?? "not given"}{ok.precipMm !== null ? `, ${Math.round(ok.precipMm * 10) / 10} mm` : ""} ({time12(ok.rainFrom, INDIA_UTC_OFFSET_MIN)}-{time12(ok.rainTo, INDIA_UTC_OFFSET_MIN)})</dd></>}
              {ok.gustKmh !== null && <><dt className="text-ink-muted">Gusts</dt><dd>up to {Math.round(ok.gustKmh)} km/h</dd></>}
              {ok.visibilityM !== null && <><dt className="text-ink-muted">Visibility</dt><dd>{ok.visibilityM >= 10_000 ? "10 km or more" : ok.visibilityM >= 1_000 ? `${Math.round(ok.visibilityM / 100) / 10} km` : `${Math.round(ok.visibilityM / 50) * 50} m`}</dd></>}
              {sun && <><dt className="text-ink-muted">Sunset there</dt><dd>{clock12(`${String(Math.floor(sun.sunsetMin / 60)).padStart(2, "0")}:${String(sun.sunsetMin % 60).padStart(2, "0")}`)}</dd></>}
              <dt className="text-ink-muted">Fetched</dt><dd>{time12(ok.fetchedAt, INDIA_UTC_OFFSET_MIN)} from Open-Meteo</dd>
            </dl>
          )}
        </>
      )}
    </article>
  );
}

/** The placeholder: the card's exact shape, so nothing moves when the forecast arrives. */
export function PlaceWeatherCardSkeleton() {
  return (
    <div aria-hidden="true" className="min-h-[11.5rem] rounded-2xl border border-line bg-white p-3.5 sm:p-4">
      <div className="flex justify-between gap-3"><div className="flex-1 space-y-2"><Skeleton className="h-3 w-40" /><Skeleton className="h-5 w-32" /><Skeleton className="h-3.5 w-44" /></div><Skeleton className="h-8 w-16" /></div>
      <Skeleton className="mt-3 h-[4.25rem] w-full" />
    </div>
  );
}

/** The Plan screen's compact line on a stop card: arrival, temperature, feels-like, day or night, rain; any alert; the day strip on tap. */
export function StopWeatherLine({ place, alerts, nowMs, onSetDates }: { place: BoardPlace | undefined; alerts: WeatherAlert[]; nowMs: number; onSetDates?: () => void }) {
  const [open, setOpen] = useState(false);
  if (!place) return <div className="mt-2 h-11 rounded-xl bg-sky/50" aria-hidden="true" />;
  const m = place.moment;
  const ok = m?.status === "ok" ? m : null;
  const noDates = place.timing.status === "no-time" && place.dayISO === null;
  if (noDates) {
    return onSetDates
      ? <button type="button" onClick={onSetDates} className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-xl border border-line bg-sky/60 px-3 text-left text-sm font-semibold text-teal-ink"><Glyph name="calendar" size={16} />No trip date set: add dates to see the weather at your arrival times</button>
      : <p className="mt-2 text-sm text-ink-muted">No trip date set: add dates to see the weather at your arrival times.</p>;
  }
  const icon = ok ? momentIcon(ok) : null;
  const hot = ok ? heatWord(ok) : null;
  return (
    <div className="mt-2 rounded-xl border border-line bg-sky/40 px-3 py-2" data-testid="stop-weather">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-11 w-full items-center justify-between gap-2 text-left">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-pine">{timeText(place, nowMs)}</span>
          <span className="block text-sm text-ink">
            {ok ? [ok.tempC !== null ? `${Math.round(ok.tempC)}°` : null, ok.feelsC !== null ? `feels ${Math.round(ok.feelsC)}°` : null, hot, dayNightWord(ok.isDay), rainText(ok)].filter(Boolean).join(" · ")
              : m && m.status !== "ok" ? missingText(m, place.typical?.text ?? null) : "The day at this place (tap to see)"}
          </span>
          {ok && <span className="block text-[11px] text-ink-muted">{stepText(ok)}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-ink-muted">{icon && <Glyph name={icon} size={20} />}<Glyph name={open ? "up" : "down"} size={14} /></span>
      </button>
      {alerts.length > 0 && <ul className="mt-1.5 space-y-1.5">{alerts.map((a) => <WeatherAlertRow key={a.id} a={a} />)}</ul>}
      {open && place.next.length > 0 && <NextHoursRow hours={place.next} label={`${place.name}: the next 12 hours around your arrival`} />}
      {open && !(m && m.status === "beyond-forecast") && <div className="mt-2"><DayStrip parts={place.parts} highlight={place.highlight} label={`${place.name}: morning, afternoon, evening and night`} /></div>}
    </div>
  );
}
