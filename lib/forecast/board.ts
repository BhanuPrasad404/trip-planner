// The weather board: where the traveller is, the coming stops (each at the time they will be there), and the road ahead, with the
// alerts for all of them. Pure: the caller supplies the forecast (from the shared store) and the clock. The screens show this.
import { forecastHorizonMs, kmFromArea, areaOf } from "./areas";
import { weatherAlerts, type AlertPlace, type WeatherAlert } from "./alerts";
import { dayParts, partOf, rainOutlook, type DayPart, type RainOutlook } from "./day-parts";
import { momentAt, type AreaData, type Moment, type MomentMissing } from "./moment";
import type { RoadPoint } from "./route-times";
import { timingFor, type PlaceTiming, type TypicalView, type ViewMode } from "./view-time";
import { istDayStartMs } from "./ist";
import { INDIA_UTC_OFFSET_MIN, dateOf } from "@/lib/travel/clock";
import { nextHours, restOfToday, weatherTip, type NextHour } from "./coming";
import type { DayPartId } from "@/lib/weather-rules";
import type { GeoPoint } from "@/lib/geo";

const HOUR = 3_600_000;

export type BoardStop = GeoPoint & {
  id: string;
  name: string;
  isNext: boolean;
  /** Live ETA while driving (null: not driving, or the route does not reach it). */
  liveEta: number | null;
  /** Planned arrival as an instant (trip day + planned time), or null. */
  planned: number | null;
  /** The stop's trip day (India date), or null when it is not scheduled. */
  dayISO: string | null;
  /** The season's typical numbers, for a stop past the 16 forecast days (from the daily climate source). */
  typical?: TypicalView | null;
};

export type BoardInput = {
  nowMs: number;
  mode: ViewMode;
  /** Where the traveller is (live GPS while driving), or null. `note`: said under the name ("Planned start, not your live location"). */
  here: (GeoPoint & { label: string; note?: string | null }) | null;
  stops: BoardStop[];
  road: RoadPoint[];
};

export type BoardPlace = GeoPoint & {
  id: string;
  name: string;
  /** A short note under the name, or null. */
  note: string | null;
  role: "here" | "stop" | "road";
  isNext: boolean;
  timing: PlaceTiming;
  /** The weather at that time; null when the place has no time (see `parts`). */
  moment: Moment | MomentMissing | null;
  /** The India day the parts are for, and the parts (null: unavailable). */
  dayISO: string | null;
  parts: DayPart[] | null;
  /** The part of that day the traveller will be there (to highlight). */
  highlight: DayPartId | null;
  /** Where the traveller is: "Dry now, rain likely 5:30-8:30 PM". */
  outlook: RainOutlook | null;
  typical: TypicalView | null;
  /** Distance from the place to its forecast point (km). */
  kmFromForecast: number;
  /** The next 12 forecast hours (a stop: centred on its arrival hour), from data already fetched. */
  next: NextHour[];
};

export type WeatherWindow = { id: string; lat: number; lng: number; from: number; to: number };

/** The time window each place needs: its moment (and the hours after it, for alerts) and the whole day it falls on (for the parts). */
export function neededWindows(input: BoardInput): WeatherWindow[] {
  const { nowMs } = input;
  const out: WeatherWindow[] = [];
  const dayOf = (t: number) => partOf(t).dayISO;
  const span = (id: string, p: GeoPoint, t: number | null, dayISO: string | null) => {
    const day = dayISO ?? (t !== null ? dayOf(t) : null);
    const starts = [t !== null ? t - HOUR : Infinity, day ? istDayStartMs(day) : Infinity];
    const ends = [t !== null ? t + 9 * HOUR : -Infinity, day ? istDayStartMs(day) + 30 * HOUR : -Infinity];
    const from = Math.min(...starts), to = Math.max(...ends);
    // Never further back than an hour ago: the parts of today that are over are shown as past, without numbers to fetch for them.
    if (Number.isFinite(from) && Number.isFinite(to)) out.push({ id, lat: p.lat, lng: p.lng, from: Math.max(from, nowMs - HOUR), to: Math.max(to, nowMs) });
  };
  if (input.here) {
    const t = input.mode.kind === "picked" ? input.mode.at : nowMs;
    span("here", input.here, t, null);
    if (input.mode.kind !== "picked") out.push({ id: "here:ahead", lat: input.here.lat, lng: input.here.lng, from: nowMs - HOUR, to: nowMs + 13 * HOUR }); // the rain outlook
  }
  for (const s of input.stops) {
    const tm = timingFor(input.mode, { role: "stop", liveEta: s.liveEta, planned: s.planned, dayISO: s.dayISO }, nowMs);
    span(`stop:${s.id}`, s, tm.status === "time" ? tm.at : null, tm.status === "no-time" ? tm.dayISO : null);
  }
  if (input.mode.kind !== "picked") for (const r of input.road) out.push({ id: r.id, lat: r.lat, lng: r.lng, from: r.at - HOUR, to: r.at + 9 * HOUR });
  // "Rest of today": where you are (else the first stop), from now until today's midnight (India). Part of the same request.
  const todayAt = input.here ?? input.stops[0] ?? null;
  if (todayAt) out.push({ id: "today", lat: todayAt.lat, lng: todayAt.lng, from: nowMs - HOUR, to: istDayStartMs(dateOf(nowMs, INDIA_UTC_OFFSET_MIN)) + 24 * HOUR });
  return out;
}

/** The board, from the forecast the caller has (`area(place, from, to)`). */
export type Board = {
  places: BoardPlace[];
  alerts: WeatherAlert[];
  /** One line for the rest of today where you are (else at the next stop): "Rain likely 6:30-8:30 PM. Calm after 8:30 PM." */
  today: { place: string; text: string } | null;
  /** One tip, only when it helps (heavy rain, very hot, fog), with real hours. */
  tip: string | null;
};

export function buildBoard(input: BoardInput, area: (p: GeoPoint, from: number, to: number) => AreaData | null, horizonEnd = forecastHorizonMs(input.nowMs)): Board {
  const { nowMs } = input;
  const windows = new Map(neededWindows(input).map((w) => [w.id, w]));
  const dataFor = (id: string, p: GeoPoint) => { const w = windows.get(id); return w ? area(p, w.from, w.to) : null; };
  const places: BoardPlace[] = [];
  const alertPlaces: AlertPlace[] = [];

  const place = (id: string, name: string, role: BoardPlace["role"], p: GeoPoint, timing: PlaceTiming, isNext: boolean, typical: TypicalView | null, data: AreaData | null, note: string | null = null, nextData: AreaData | null = null) => {
    const t = timing.status === "time" ? timing.at : null;
    const dayISO = timing.status === "no-time" ? timing.dayISO : t !== null ? partOf(t).dayISO : null;
    const moment = t !== null ? momentAt(data, p, t, nowMs, horizonEnd) : null;
    places.push({
      next: role === "road" ? [] : nextHours(nextData ?? data, p, role === "here" && timing.status === "time" && timing.basis === "now" ? null : t, nowMs, horizonEnd),
      lat: p.lat, lng: p.lng, id, name, note, role, isNext, timing, moment, dayISO,
      parts: dayISO && role !== "road" ? dayParts(data, p, dayISO, nowMs, horizonEnd) : null,
      highlight: t !== null ? partOf(t).id : null,
      outlook: null, typical, kmFromForecast: kmFromArea(p, areaOf(p)),
    });
    if (t !== null && timing.status === "time") alertPlaces.push({ ...p, id, name, role, isNext, at: t, basis: timing.basis, area: data });
  };

  if (input.here) {
    const timing = timingFor(input.mode, { role: "here" }, nowMs);
    place("here", input.here.label, "here", input.here, timing, false, null, dataFor("here", input.here), input.here.note ?? null, input.mode.kind === "picked" ? null : dataFor("here:ahead", input.here));
    if (input.mode.kind !== "picked") places[places.length - 1].outlook = rainOutlook(dataFor("here:ahead", input.here), input.here, nowMs, horizonEnd);
  }
  for (const s of input.stops) {
    const timing = timingFor(input.mode, { role: "stop", liveEta: s.liveEta, planned: s.planned, dayISO: s.dayISO }, nowMs);
    place(s.id, s.name, "stop", s, timing, s.isNext, s.typical ?? null, dataFor(`stop:${s.id}`, s));
  }
  if (input.mode.kind !== "picked") {
    for (const r of input.road) {
      const data = dataFor(r.id, r);
      // The road is for alerts only (it is not a place to show a card for).
      alertPlaces.push({ ...r, name: `about ${r.kmAhead} km ahead`, role: "road", at: r.at, basis: "live", kmAhead: r.kmAhead, area: data });
    }
  }
  const alerts = weatherAlerts(alertPlaces, nowMs, horizonEnd);
  // The rest of today: where you are (now), else the first stop. Its data window covers today (lib/forecast/board.ts neededWindows).
  const todayPlace = input.here ?? input.stops[0] ?? null;
  const todayAt = todayPlace ? { p: todayPlace, name: input.here ? input.here.label : input.stops[0].name, data: dataFor("today", todayPlace) } : null;
  const rest = todayAt ? restOfToday(todayAt.data, todayAt.p, nowMs, horizonEnd) : null;
  return { places, alerts, today: rest ? { place: todayAt!.name, text: rest.text } : null, tip: weatherTip(alerts) };
}
