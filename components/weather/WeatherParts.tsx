// The weather building blocks every screen uses (Plan, Live, Map, the trip's Weather page). Big, colourful and calm:
//   • every card wears the weather it shows: a gradient and a moving picture (sun, rain, storm, fog, heat, cold…, components/weather/WeatherScene.tsx);
//   • the time the traveller will be there is the main text; the forecast step is small and secondary;
//   • a stop with NO arrival time shows its whole day (high and low, rain, the best time, the four parts, the hours) instead of asking for a time;
//   • severity is always an icon AND a word (Watch, Warning, Severe), never colour alone;
//   • a card keeps the same size while loading, so nothing jumps.
// All wording comes from lib/forecast/present.ts and lib/forecast/day-summary.ts; every number comes from the forecast for that place at that moment.
import { useState, type CSSProperties, type ReactNode } from "react";
import type { BoardPlace } from "@/lib/forecast/board";
import type { WeatherAlert } from "@/lib/forecast/alerts";
import type { DayPart } from "@/lib/forecast/day-parts";
import type { NextHour } from "@/lib/forecast/coming";
import { ALERT_PALETTE, HOUR_PILL, PALETTE, SCENE_WORD, gradientOf, sceneForMoment, sceneForPart, type Scene, type SceneKind } from "@/lib/forecast/scene";
import type { GlyphName } from "@/lib/glyphs";
import { KIND_ICON, SEVERITY_ICON, alertHeadline, dayNightWord, heatWord, missingText, momentIcon, partSummary, rainText, severityWord, stepText, timeText } from "@/lib/forecast/present";
import { sunTimes } from "@/lib/intel/sun";
import { INDIA_UTC_OFFSET_MIN, clock12, time12 } from "@/lib/travel/clock";
import type { Severity } from "@/lib/weather-rules";
import { Glyph } from "@/components/ui/Glyph";
import { Skeleton } from "@/components/ui/Skeleton";
import { WeatherScene } from "./WeatherScene";

const deg = (n: number | null) => (n === null ? "–" : `${Math.round(n)}°`);
const ICON_FOR_SCENE: Record<SceneKind, GlyphName> = { sun: "sun", clear_night: "moon", cloud: "cloudSun", cloud_night: "cloudMoon", rain: "rain", heavy_rain: "rain", storm: "storm", fog: "fog", heat: "thermometer", cold: "snow", snow: "snow" };
/** A scene's icon moves in its own way: ONLY the sun turns (a thermometer or a cloud that spun would look broken); everything else floats. */
const iconMotion = (k: SceneKind) => (k === "sun" ? "wx-spin-slow" : "wx-float");
/** These scenes already draw a sun or a moon in the top corner: a second icon there would sit on top of it. */
const ART_IN_CORNER = new Set<SceneKind>(["sun", "heat", "clear_night", "cloud_night"]);

/** Inline, from the tested palette (lib/forecast/scene.ts): the same on the light theme and the phone theme. */
const alertStyle = (l: Severity): CSSProperties => ({ background: ALERT_PALETTE[l].bg, color: ALERT_PALETTE[l].text, borderColor: ALERT_PALETTE[l].border });

/** "⚠ Warning": icon and word together. */
export function SeverityBadge({ level }: { level: Severity }) {
  return (
    <span style={alertStyle(level)} className="inline-flex shrink-0 items-center gap-1 rounded-full border-2 px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-wide">
      <Glyph name={SEVERITY_ICON[level]} size={13} strokeWidth={2.6} />{severityWord(level)}
    </span>
  );
}

/** One alert: how bad, what and where and when, what to do, and where it comes from. A thick banner; a severe one pulses gently. */
export function WeatherAlertRow({ a }: { a: WeatherAlert }) {
  return (
    <li data-alert={a.kind} data-level={a.level} style={alertStyle(a.level)} className="rounded-2xl border-2 px-3.5 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge level={a.level} />
        <span className="text-xs font-bold">{a.when}</span>
      </div>
      <p className="mt-1.5 flex items-start gap-2 text-sm font-bold">
        <span style={{ background: "rgba(255,255,255,0.75)" }} className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${a.level === "severe" ? "wx-pulse" : ""}`}><Glyph name={KIND_ICON[a.kind]} size={16} /></span>
        <span className="min-w-0 break-words">{alertHeadline(a)}{a.detail ? <span className="font-medium opacity-80"> · {a.detail}</span> : null}</span>
      </p>
      {a.advice && <p className="mt-1.5 text-sm font-medium">{a.advice}</p>}
      <p className="mt-1.5 text-[11px] font-semibold opacity-75">{a.source} forecast for {time12(a.forecastFor, INDIA_UTC_OFFSET_MIN)}</p>
    </li>
  );
}

/** A coloured card wearing a scene. Text colour comes from the scene's own palette (tested for contrast). */
function SceneBox({ scene, lite, className = "", children, ...rest }: { scene: Scene; lite?: boolean; className?: string; children: ReactNode } & Record<string, unknown>) {
  const p = PALETTE[scene.kind];
  return (
    <div {...rest} data-scene={scene.kind} style={{ background: gradientOf(scene.kind), color: p.text } as CSSProperties} className={`relative isolate overflow-hidden ${className}`}>
      <WeatherScene kind={scene.kind} intensity={scene.intensity} lite={lite} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

/** A small fact on a scene: it stands off the gradient on a see-through chip. */
function Chip({ scene, icon, children }: { scene: SceneKind; icon?: GlyphName; children: ReactNode }) {
  return <span style={{ background: PALETTE[scene].chip }} className="inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold">{icon && <Glyph name={icon} size={13} />}<span className="min-w-0 break-words">{children}</span></span>;
}

/** Morning, afternoon, evening, night: four thick tiles, each wearing its own weather. The part the traveller will be there is ringed and says so; past parts say "Earlier". */
export function DayStrip({ parts, highlight, label }: { parts: DayPart[] | null; highlight: BoardPlace["highlight"]; label: string }) {
  if (!parts) return <div className="h-[5.5rem] rounded-2xl bg-sky/60" aria-hidden="true" />;
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={label}>
      {parts.map((p) => {
        const s = partSummary(p);
        const mine = highlight === p.id;
        const scene = p.past ? null : sceneForPart(p);
        const pal = scene ? PALETTE[scene.kind] : null;
        const range = p.tempMinC != null && p.tempMaxC != null ? (Math.round(p.tempMinC) === Math.round(p.tempMaxC) ? deg(p.tempMaxC) : `${Math.round(p.tempMinC)}–${deg(p.tempMaxC)}`) : null;
        return (
          <li key={p.id} style={pal ? ({ background: gradientOf(scene!.kind), color: pal.text } as CSSProperties) : undefined}
            className={`relative flex min-h-[5.5rem] min-w-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-1.5 py-2.5 text-center shadow-sm ${pal ? "" : "border-2 border-dashed border-current/40 bg-white/15"} ${mine ? "ring-4 ring-white shadow-xl" : ""} ${p.past ? "opacity-75" : ""}`}>
            <span className="max-w-full break-words text-xs font-extrabold uppercase tracking-wide">{p.label}</span>
            {s.icon && <Glyph name={scene ? ICON_FOR_SCENE[scene.kind] : s.icon} size={20} className={scene ? iconMotion(scene.kind) : ""} />}
            {range && !p.past && <span className="font-display text-base font-bold leading-tight">{range}</span>}
            <span className="max-w-full break-words text-xs font-bold leading-tight">{p.past ? "Earlier" : s.word}</span>
            {!p.past && (s.rain || s.feels) && <span className="max-w-full break-words text-[11px] font-semibold leading-tight opacity-90">{[s.rain ? `${s.rain} rain` : null, s.feels].filter(Boolean).join(" · ")}</span>}
            {mine && <span className="mt-0.5 rounded-full bg-pine px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">You&apos;ll be here</span>}
            {mine && <span className="sr-only"> (you will be there then)</span>}
            {p.coverage === "partial" && !p.past && <span className="text-[10px] font-semibold opacity-80">part forecast</span>}
          </li>
        );
      })}
    </ol>
  );
}

const hourIcon = (h: NextHour): GlyphName => (h.level !== null && h.precipProb !== null && h.precipProb >= 60 ? "rain" : h.isDay === false ? "moon" : "sun");

/**
 * The hours in a row: the hour, sun or moon (rain when it is likely), the temperature, and the rain chance as a bar AND a number (never
 * colour alone). The arrival hour is ringed and says so. Scrolls sideways on a small phone and snaps to each hour.
 */
export function NextHoursRow({ hours, label }: { hours: NextHour[]; label: string }) {
  if (hours.length === 0) return <p className="mt-2 text-sm text-ink-muted">No hourly forecast for this place right now.</p>;
  return (
    <ol aria-label={label} className="relative mt-2 flex snap-x snap-proximity gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]" data-testid="next-hours">
      {hours.map((h) => {
        const pct = h.precipProb !== null ? Math.max(0, Math.min(100, Math.round(h.precipProb))) : null;
        const icon = pct !== null && pct >= 60 ? "rain" : hourIcon(h);
        const clock = time12(h.time, INDIA_UTC_OFFSET_MIN);
        const night = h.isDay === false;
        return (
          <li key={h.time} style={{ background: HOUR_PILL[night ? "night" : "day"].bg, color: HOUR_PILL[night ? "night" : "day"].text } as CSSProperties}
            className={`flex w-[4.5rem] shrink-0 snap-start flex-col items-center rounded-2xl px-1.5 py-2 text-center shadow-sm ${h.isArrival ? "ring-4 ring-white shadow-xl" : ""}`}>
            <span className="text-xs font-extrabold">{clock.replace(" AM", "a").replace(" PM", "p")}</span>
            <span className="my-0.5 h-6"><Glyph name={icon} size={20} className={icon === "sun" ? "wx-spin-slow" : "wx-float"} /></span>
            <span className="font-display text-lg font-bold leading-none">{h.tempC !== null ? `${Math.round(h.tempC)}°` : "–"}</span>
            <span aria-hidden="true" className="mt-1.5 flex h-9 w-3.5 items-end overflow-hidden rounded-full" style={{ background: HOUR_PILL[night ? "night" : "day"].track }}><span className="wx-bar w-full rounded-full" style={{ height: `${pct ?? 0}%`, background: HOUR_PILL.drop }} /></span>
            <span className="mt-0.5 text-xs font-bold">{pct !== null ? `${pct}%` : "–"}</span>
            {h.isArrival && <span className="mt-0.5 text-[10px] font-extrabold uppercase">Arrive</span>}
            <span className="sr-only">{`${clock}: ${h.tempC !== null ? `${Math.round(h.tempC)} degrees` : "no temperature"}, ${pct !== null ? `${pct}% chance of rain` : "rain chance not given"}, ${h.isDay === false ? "night" : h.isDay ? "day" : ""}${h.isArrival ? ", when you arrive" : ""}`}</span>
          </li>
        );
      })}
    </ol>
  );
}

const ROLE_LABEL = (p: BoardPlace) => (p.role === "here" ? "Where you are" : p.isNext ? "Next stop" : "Stop");
const WHOLE_DAY_NOTE = "No arrival time set, so this is the whole day. Add a time in your plan to see one exact hour.";

/**
 * One place. With a time: the weather at that moment (big temperature, feels like, day or night, rain) wearing its scene. With no time but
 * a day: that whole day. With neither: what we can say. Tap "hours" for the row of hours; alerts sit inside the card.
 */
export function PlaceWeatherCard({ place, alerts, nowMs, onSetDates }: { place: BoardPlace; alerts: WeatherAlert[]; nowMs: number; onSetDates?: () => void }) {
  const [open, setOpen] = useState(false);
  const main = place.role === "here";
  const m = place.moment;
  const ok = m?.status === "ok" ? m : null;
  const noDates = place.timing.status === "no-time" && place.dayISO === null && place.role === "stop";
  const day = !ok && !noDates && place.summary ? place.summary : null;
  const scene: Scene | null = ok ? sceneForMoment(ok) : day ? day.scene : null;
  const title = place.name, note = place.note;
  const hot = ok ? heatWord(ok) : null;
  const sun = place.timing.status === "time" ? sunTimes(place.lat, place.lng, place.timing.at, INDIA_UTC_OFFSET_MIN) : null;
  const hours = ok ? place.next : place.dayHours;
  const canOpen = hours.length > 0;
  const pal = scene ? PALETTE[scene.kind] : null;
  const timeLine = <span className="block font-display text-lg font-bold leading-tight sm:text-xl" data-testid="time-text">{noDates ? "No trip date set" : timeText(place, nowMs)}</span>;
  const icon: GlyphName | null = ok ? momentIcon(ok) : scene ? ICON_FOR_SCENE[scene.kind] : null;

  const head = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-xs font-extrabold uppercase tracking-wide opacity-85">{ROLE_LABEL(place)} · <span className="normal-case tracking-normal">{title}</span></span>
          {note && <span className="block text-sm font-bold opacity-90">{note}</span>}
          {timeLine}
        </div>
        {icon && scene && !ART_IN_CORNER.has(scene.kind) && <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${iconMotion(scene.kind)}`} style={{ background: pal!.chip }}><Glyph name={icon} size={28} /></span>}
      </div>
      {ok && ok.tempC !== null && (
        <div className="mt-2 flex items-end gap-3">
          <span className={`font-display font-extrabold leading-none tracking-tight ${main ? "text-7xl" : "text-6xl"}`}>{Math.round(ok.tempC)}°</span>
          <span className="min-w-0 pb-1">
            <span className="block text-base font-bold leading-tight">{[dayNightWord(ok.isDay), ok.condition].filter(Boolean).join(" · ")}</span>
            {ok.feelsC !== null && <span className="block text-sm font-semibold opacity-90">feels {Math.round(ok.feelsC)}°</span>}
            {hot && <span className="block text-sm font-extrabold">{hot}</span>}
          </span>
        </div>
      )}
      {ok && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {rainText(ok) && <Chip scene={scene!.kind} icon="rain">{rainText(ok)}</Chip>}
          {ok.gustKmh !== null && ok.gustKmh >= 30 && <Chip scene={scene!.kind} icon="wind">Gusts up to {Math.round(ok.gustKmh)} km/h</Chip>}
          {ok.visibilityM !== null && ok.visibilityM < 5000 && <Chip scene={scene!.kind} icon="fog">Visibility {ok.visibilityM >= 1000 ? `${Math.round(ok.visibilityM / 100) / 10} km` : `${Math.round(ok.visibilityM / 50) * 50} m`}</Chip>}
        </div>
      )}
      {ok && <p className="mt-2 text-xs font-semibold opacity-85">{stepText(ok)} · Open-Meteo</p>}
      {day && (
        <>
          <div className="mt-2 flex items-end gap-3">
            <span className={`font-display font-extrabold leading-none tracking-tight ${main ? "text-7xl" : "text-6xl"}`}>{deg(day.highC)}</span>
            <span className="min-w-0 pb-1"><span className="block text-base font-bold leading-tight">{day.allPast ? day.headline : "High"}</span>{day.lowC !== null && <span className="block text-sm font-semibold opacity-90">low {deg(day.lowC)}</span>}</span>
          </div>
          {!day.allPast && <p className="mt-1.5 text-base font-bold leading-snug">{day.headline}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {day.rainChanceMax !== null && <Chip scene={scene!.kind} icon="rain">Rain chance up to {Math.round(day.rainChanceMax)}%</Chip>}
            {day.feelsMaxC !== null && <Chip scene={scene!.kind} icon="thermometer">Feels up to {deg(day.feelsMaxC)}</Chip>}
            {day.best && <Chip scene={scene!.kind} icon="check">Best time: {day.best.text}</Chip>}
            {day.restOfDay && <Chip scene={scene!.kind} icon="recent">Rest of today</Chip>}
          </div>
          <p className="mt-2 text-xs font-semibold opacity-90">{WHOLE_DAY_NOTE}</p>
        </>
      )}
      {scene && <span className="sr-only">{SCENE_WORD[scene.kind]}</span>}
    </>
  );

  const extras = (
    <>
      {m && m.status !== "ok" && <p className="mt-2 text-sm font-medium">{missingText(m, place.typical?.text ?? null)}</p>}
      {alerts.length > 0 && <ul className="mt-3 space-y-2 text-left">{alerts.map((a) => <WeatherAlertRow key={a.id} a={a} />)}</ul>}
      {place.role !== "road" && !noDates && (place.parts || place.timing.status === "time") && !(m && m.status === "beyond-forecast") && (
        <div className="mt-3"><DayStrip parts={place.parts} highlight={place.highlight} label={`${title}: morning, afternoon, evening and night`} /></div>
      )}
      {canOpen && (
        <>
          <button type="button" data-testid="card-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ background: pal?.chip }} className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-extrabold">
            {open ? "Hide the hours" : ok ? (main ? "Next 12 hours" : "Hours around your arrival") : "Hour by hour"}<Glyph name={open ? "up" : "down"} size={14} />
          </button>
          {open && <NextHoursRow hours={hours} label={`${title}: ${ok ? "the hours around your arrival" : "the hours of the day"}`} />}
          {open && ok && (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-2xl px-3.5 py-3 text-sm font-medium" style={{ background: pal?.chip }}>
              {ok.rainFrom !== null && ok.rainTo !== null && <><dt className="opacity-80">Rain</dt><dd>{rainText(ok) ?? "not given"}{ok.precipMm !== null ? `, ${Math.round(ok.precipMm * 10) / 10} mm` : ""} ({time12(ok.rainFrom, INDIA_UTC_OFFSET_MIN)}-{time12(ok.rainTo, INDIA_UTC_OFFSET_MIN)})</dd></>}
              {ok.gustKmh !== null && <><dt className="opacity-80">Gusts</dt><dd>up to {Math.round(ok.gustKmh)} km/h</dd></>}
              {ok.visibilityM !== null && <><dt className="opacity-80">Visibility</dt><dd>{ok.visibilityM >= 10_000 ? "10 km or more" : ok.visibilityM >= 1_000 ? `${Math.round(ok.visibilityM / 100) / 10} km` : `${Math.round(ok.visibilityM / 50) * 50} m`}</dd></>}
              {sun && <><dt className="opacity-80">Sunset there</dt><dd>{clock12(`${String(Math.floor(sun.sunsetMin / 60)).padStart(2, "0")}:${String(sun.sunsetMin % 60).padStart(2, "0")}`)}</dd></>}
              <dt className="opacity-80">Fetched</dt><dd>{time12(ok.fetchedAt, INDIA_UTC_OFFSET_MIN)} from Open-Meteo</dd>
            </dl>
          )}
        </>
      )}
    </>
  );

  // No date at all: nothing to show a forecast for. Say so, and give the way to fix it.
  if (noDates || (!scene && !(m && m.status !== "ok" && !day))) {
    return (
      <article data-place={place.id} aria-label={`Weather for ${title}`} className="wx-rise rounded-3xl border-2 border-line bg-white p-4 shadow-sm">
        <span className="block text-xs font-extrabold uppercase tracking-wide text-ink-muted">{ROLE_LABEL(place)} · <span className="normal-case tracking-normal">{title}</span></span>
        <span className="mt-0.5 block font-display text-xl font-bold text-pine" data-testid="time-text">{noDates ? "No trip date set" : timeText(place, nowMs)}</span>
        {noDates && onSetDates && <button type="button" onClick={onSetDates} className="tm-action mt-1 min-h-11 text-left text-sm font-semibold">No trip date set: add dates to see the weather at your arrival times</button>}
        {!noDates && <p className="mt-1 text-sm text-ink-muted">{place.typical?.text ?? "No forecast for that day yet. Check again closer to the time."}</p>}
      </article>
    );
  }
  if (!scene) {
    return (
      <article data-place={place.id} aria-label={`Weather for ${title}`} className="wx-rise rounded-3xl border-2 border-line bg-white p-4 shadow-sm">
        <span className="block text-xs font-extrabold uppercase tracking-wide text-ink-muted">{ROLE_LABEL(place)} · <span className="normal-case tracking-normal">{title}</span></span>
        <span className="mt-0.5 block font-display text-xl font-bold text-pine" data-testid="time-text">{timeText(place, nowMs)}</span>
        {m && <p className="mt-1 text-sm text-ink-muted">{missingText(m as never, place.typical?.text ?? null)}</p>}
      </article>
    );
  }
  return (
    <SceneBox scene={scene} lite={!main} data-place={place.id} aria-label={`Weather for ${title}`} className={`wx-rise rounded-3xl border border-white/30 p-4 shadow-[0_14px_32px_-14px_rgba(11,33,66,0.6)] sm:p-5 ${main ? "min-h-[13rem]" : ""}`}>
      {head}
      {extras}
    </SceneBox>
  );
}

/** The placeholder: the card's exact shape, so nothing moves when the forecast arrives. */
export function PlaceWeatherCardSkeleton() {
  return (
    <div aria-hidden="true" className="min-h-[11.5rem] rounded-3xl border-2 border-line bg-white p-4 shadow-sm sm:p-5">
      <div className="flex justify-between gap-3"><div className="flex-1 space-y-2"><Skeleton className="h-3 w-40" /><Skeleton className="h-5 w-32" /></div><Skeleton className="h-12 w-12 rounded-2xl" /></div>
      <Skeleton className="mt-4 h-14 w-28" />
      <Skeleton className="mt-3 h-[5.5rem] w-full rounded-2xl" />
    </div>
  );
}

/** The Plan screen's compact card on a stop: a scene strip with the arrival (or the whole day), the numbers, and the day on tap. */
export function StopWeatherLine({ place, alerts, nowMs, onSetDates, datesPassed = false }: { place: BoardPlace | undefined; alerts: WeatherAlert[]; nowMs: number; onSetDates?: () => void; /** The trip's planned dates are over: the weather shown is for right now, and says so. */ datesPassed?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!place) return <div className="mt-2 h-[4.5rem] rounded-2xl bg-sky/50" aria-hidden="true" />;
  const m = place.moment;
  const ok = m?.status === "ok" ? m : null;
  const noDates = place.timing.status === "no-time" && place.dayISO === null;
  if (noDates) {
    return onSetDates
      ? <button type="button" onClick={onSetDates} className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-2xl border-2 border-line bg-sky/60 px-3 text-left text-sm font-semibold text-teal-ink"><Glyph name="calendar" size={16} />No trip date set: add dates to see the weather at your arrival times</button>
      : <p className="mt-2 text-sm text-ink-muted">No trip date set: add dates to see the weather at your arrival times.</p>;
  }
  const day = !ok ? place.summary : null;
  const scene: Scene | null = ok ? sceneForMoment(ok) : day ? day.scene : null;
  const hot = ok ? heatWord(ok) : null;
  const headline = datesPassed && place.timing.status === "time" && place.timing.basis === "now" ? "If you go today · right now" : timeText(place, nowMs);
  const hours = ok ? place.next : place.dayHours;
  if (!scene) {
    return (
      <div className="mt-2 rounded-2xl border-2 border-line bg-sky/40 px-3 py-2.5" data-testid="stop-weather">
        <span className="block text-sm font-bold text-pine">{headline}</span>
        <span className="block text-sm text-ink">{m && m.status !== "ok" ? missingText(m, place.typical?.text ?? null) : place.typical?.text ?? "No forecast for that day yet. Check again closer to the time."}</span>
        {alerts.length > 0 && <ul className="mt-1.5 space-y-1.5">{alerts.map((a) => <WeatherAlertRow key={a.id} a={a} />)}</ul>}
      </div>
    );
  }
  const icon = ok ? momentIcon(ok) ?? ICON_FOR_SCENE[scene.kind] : ICON_FOR_SCENE[scene.kind];
  const line = ok
    ? [ok.tempC !== null ? `${Math.round(ok.tempC)}°` : null, ok.feelsC !== null ? `feels ${Math.round(ok.feelsC)}°` : null, hot, dayNightWord(ok.isDay), rainText(ok)].filter(Boolean).join(" · ")
    : day ? [`High ${deg(day.highC)}`, day.lowC !== null ? `low ${deg(day.lowC)}` : null, day.rainChanceMax !== null ? `rain up to ${Math.round(day.rainChanceMax)}%` : null].filter(Boolean).join(" · ") : "";
  const pal = PALETTE[scene.kind];
  return (
    <SceneBox scene={scene} lite className="wx-rise mt-2 rounded-2xl border border-white/30 shadow-[0_10px_24px_-14px_rgba(11,33,66,0.6)]" data-testid="stop-weather">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-[4.5rem] w-full items-center gap-3 px-3.5 py-3 text-left">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${iconMotion(scene.kind)}`} style={{ background: pal.chip }}><Glyph name={icon} size={24} /></span>
        <span className={`min-w-0 flex-1 ${scene.kind === "clear_night" || scene.kind === "cloud_night" ? "pr-16" : "pr-2"}`}>
          <span className="block text-sm font-extrabold">{headline}</span>
          <span className="block break-words text-sm font-semibold">{line}</span>
          {day && <span className="block break-words text-xs font-semibold opacity-90">{day.headline}{day.best ? ` · Best: ${day.best.label}` : ""}</span>}
          {ok && <span className="block text-[11px] font-semibold opacity-85">{stepText(ok)}</span>}
        </span>
        <Glyph name={open ? "up" : "down"} size={14} className="shrink-0" />
      </button>
      {scene && <span className="sr-only">{SCENE_WORD[scene.kind]}</span>}
      {alerts.length > 0 && <ul className="space-y-1.5 px-3 pb-2">{alerts.map((a) => <WeatherAlertRow key={a.id} a={a} />)}</ul>}
      {open && (
        <div className="space-y-2 px-3 pb-3">
          {day && <p className="text-xs font-semibold opacity-90">{WHOLE_DAY_NOTE}</p>}
          {hours.length > 0 && <NextHoursRow hours={hours} label={`${place.name}: ${ok ? "the hours around your arrival" : "the hours of the day"}`} />}
          {!(m && m.status === "beyond-forecast") && <DayStrip parts={place.parts} highlight={place.highlight} label={`${place.name}: morning, afternoon, evening and night`} />}
        </div>
      )}
    </SceneBox>
  );
}
