// Weather alerts for the places a traveller cares about: where they are, the next stop, every later stop, and the road ahead. Pure.
//
//   WHERE   the place (and "about 45 km ahead" for the road)
//   WHEN    the moment the traveller will be there (now, the live ETA, or the planned time), plus the stretch of hours it lasts
//   HOW BAD Watch / Warning / Severe (lib/weather-rules.ts), as a word
//   WHAT TO DO  only when it is useful and possible: a live ETA cannot be made earlier, a planned time can
//   SOURCE  Open-Meteo, the forecast step it comes from, and when that forecast was fetched
//
// One alert per place and kind (its id), so an alert is never repeated: when the forecast changes, the same alert updates (or is gone).
// Sorted soonest first (the traveller meets them in that order); at the same time, the more severe first.
import type { GeoPoint } from "@/lib/geo";
import { INDIA_UTC_OFFSET_MIN, dayShiftLabel, time12 } from "@/lib/travel/clock";
import { DRIVE_ALERT_AHEAD_MS, SEVERITY_RANK, WEATHER_SOURCE, type HourHazard, type Severity, type WeatherKind } from "@/lib/weather-rules";
import { momentAt, type AreaData, type Moment } from "./moment";

const HOUR = 3_600_000;
/** Also look this far after arriving: rain that starts soon after you get there matters for the visit. */
const AFTER_ARRIVAL_MS = HOUR;
/** How far around the moment a hazard's stretch is followed (before and after). */
const SPAN_BACK_MS = 3 * HOUR;
const SPAN_AHEAD_MS = 8 * HOUR;

export type AlertPlace = GeoPoint & {
  id: string;
  name: string;
  role: "here" | "stop" | "road";
  /** The next stop of the drive. */
  isNext?: boolean;
  /** When the traveller will be there. */
  at: number;
  /** "now" (here), "live" (ETA while driving: cannot be made earlier), "planned" (a plan can still change), "picked" (a time chosen). */
  basis: "now" | "live" | "planned" | "picked";
  /** For the road: km ahead of the traveller. */
  kmAhead?: number;
  area: AreaData | null | undefined;
};

export type WeatherAlert = {
  /** Stable: place and kind. The same alert keeps its id while it changes. */
  id: string;
  placeId: string;
  place: string;
  role: AlertPlace["role"];
  isNext: boolean;
  kind: WeatherKind;
  level: Severity;
  label: string;
  detail: string;
  /** When the traveller meets it (their arrival, or when it starts if that is soon after arriving). */
  at: number;
  /** The stretch of time it lasts around then, as far as the forecast shows. `open` = it goes on past what was looked at. */
  window: { from: number; to: number; open: boolean };
  /** Text: "in about 40 min, at 4:30 PM". */
  when: string;
  advice: string | null;
  source: string;
  /** The forecast step this comes from (its time). */
  forecastFor: number;
  fetchedAt: number;
};

const levelOf = (m: Moment, kind: WeatherKind): HourHazard | null => m.hazards.find((h) => h.kind === kind) ?? null;

/** "now", "in about 40 min, at 4:30 PM", "in about 3 h, at 9:30 PM", "tomorrow at 6:30 AM", "Sat 25 Oct at 6:30 AM". */
export function whenText(at: number, nowMs: number, offsetMin = INDIA_UTC_OFFSET_MIN): string {
  const min = Math.round((at - nowMs) / 60_000);
  const clock = time12(at, offsetMin);
  if (min <= 5) return min < -5 ? `since ${clock}` : "now";
  const shift = dayShiftLabel(nowMs, at, offsetMin);
  if (shift === "next day") return `tomorrow at ${clock}`;
  if (shift) return `${new Date(at + offsetMin * 60_000).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} at ${clock}`;
  return `in about ${min < 60 ? `${Math.round(min / 5) * 5 || 5} min` : `${Math.round(min / 60)} h`}, at ${clock}`;
}

/** The stretch around `t` where this kind of hazard holds (each hour judged on its own), within the forecast. */
function spanOf(p: AlertPlace, kind: WeatherKind, t: number, nowMs: number, horizonEnd: number): { from: number; to: number; open: boolean } {
  const at = (x: number) => { const m = momentAt(p.area, p, x, nowMs, horizonEnd); return m.status === "ok" ? m : null; };
  let first = at(t)!, last = first;
  for (let x = t - HOUR; x >= t - SPAN_BACK_MS && x >= nowMs - HOUR; x -= HOUR) { const m = at(x); if (!m || !levelOf(m, kind)) break; first = m; }
  let open = false;
  for (let x = t + HOUR; ; x += HOUR) {
    if (x > t + SPAN_AHEAD_MS) { open = true; break; }
    const m = at(x);
    if (!m) { open = true; break; } // the forecast ends here: we do not know when it stops
    if (!levelOf(m, kind)) break;
    last = m;
  }
  // The edges are real forecast boundaries: rain covers whole rain-hours (each from its own step); the others hold around their step.
  if (kind === "rain" && first.rainFrom !== null && last.rainTo !== null) return { from: first.rainFrom, to: last.rainTo, open };
  return { from: first.shownAt - HOUR / 2, to: last.shownAt + HOUR / 2, open };
}

function adviceFor(kind: WeatherKind, level: Severity, p: AlertPlace, now: number, span: { from: number; to: number; open: boolean }, startsAfterArrival: boolean): string | null {
  const t = (ms: number) => time12(ms, INDIA_UTC_OFFSET_MIN);
  const eases = span.open ? null : t(span.to);
  const canMove = p.basis === "planned";
  if (kind === "rain") {
    if (p.role === "road") return level === "watch" ? "Rain likely on this stretch. Keep your speed down." : "Slow down, keep a long gap and switch your lights on.";
    if (p.role === "here") return level === "watch" ? null : eases ? `It should ease by about ${eases}.` : null;
    if (startsAfterArrival) return `It starts about ${Math.round((span.from - p.at) / 60_000 / 5) * 5} min after you arrive: do the outdoor part first, or carry rain gear.`;
    if (level === "watch") return "Carry rain gear.";
    if (canMove && span.from > now) return eases ? `Plan to arrive before ${t(span.from)} or after ${eases}, or carry rain gear.` : `Plan to arrive before ${t(span.from)}, or carry rain gear.`;
    if (canMove) return eases ? `Plan to arrive after ${eases}, or carry rain gear.` : "Carry rain gear.";
    return eases ? `It should ease by about ${eases}: wait it out nearby, or keep rain gear ready.` : "Keep rain gear ready.";
  }
  if (kind === "storm") return eases ? `Stay off exposed places and avoid driving through it. It should pass by about ${eases}.` : "Stay off exposed places and avoid driving through it.";
  if (kind === "visibility") {
    if (level === "watch") return "Drive with care and keep your lights on.";
    return eases ? `Drive slowly on low beams and keep a long gap. It should clear by about ${eases}.` : "Drive slowly on low beams and keep a long gap.";
  }
  // heat
  if (p.role === "road") return null;
  if (level === "watch") return "Carry water.";
  return eases ? `Carry water and keep time in the sun short. It eases after about ${eases}.` : "Carry water and keep time in the sun short.";
}

/** Every alert for these places, soonest first (the more severe first at the same time). */
export function weatherAlerts(places: AlertPlace[], nowMs: number, horizonEnd: number): WeatherAlert[] {
  const out = new Map<string, WeatherAlert>();
  for (const p of places) {
    // The moment they are there, and (for a stop) the hour after arriving.
    const times = p.role === "stop" ? [p.at, p.at + AFTER_ARRIVAL_MS / 2, p.at + AFTER_ARRIVAL_MS] : [p.at];
    for (const t of times) {
      const m = momentAt(p.area, p, t, nowMs, horizonEnd);
      if (m.status !== "ok") continue;
      for (const h of m.hazards) {
        const id = `${p.id}:${h.kind}`;
        const prev = out.get(id);
        if (prev && SEVERITY_RANK[prev.level] >= SEVERITY_RANK[h.level]) continue; // one per place and kind: keep the worst
        const span = spanOf(p, h.kind, t, nowMs, horizonEnd);
        const startsAfter = t > p.at && span.from > p.at; // it really begins after arrival (not: already there, and worse later)
        const at = startsAfter ? Math.max(p.at, span.from) : p.at;
        out.set(id, {
          id, placeId: p.id, place: p.name, role: p.role, isNext: !!p.isNext, kind: h.kind, level: h.level, label: h.label, detail: h.detail,
          at, window: span, when: whenText(at, nowMs), advice: adviceFor(h.kind, h.level, p, nowMs, span, startsAfter),
          source: WEATHER_SOURCE, forecastFor: h.kind === "rain" && m.rainTo !== null ? m.rainTo : m.shownAt, fetchedAt: m.fetchedAt,
        });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.at - b.at || SEVERITY_RANK[b.level] - SEVERITY_RANK[a.level] || a.id.localeCompare(b.id));
}

/** What changed between two sets of alerts: new ones, ones whose level or timing changed, and ones that are gone. */
export function diffAlerts(prev: WeatherAlert[], next: WeatherAlert[]): { added: WeatherAlert[]; changed: WeatherAlert[]; removed: WeatherAlert[] } {
  const before = new Map(prev.map((a) => [a.id, a]));
  const after = new Map(next.map((a) => [a.id, a]));
  return {
    added: next.filter((a) => !before.has(a.id)),
    changed: next.filter((a) => { const b = before.get(a.id); return !!b && (b.level !== a.level || b.window.from !== a.window.from || b.window.to !== a.window.to || b.detail !== a.detail); }),
    removed: prev.filter((a) => !after.has(a.id)),
  };
}

/** While driving: Warning or Severe, for the next stop or the road ahead, within the next 2 hours. These go to the app's alert list. */
export const isDriveAlert = (a: WeatherAlert, nowMs: number) =>
  SEVERITY_RANK[a.level] >= SEVERITY_RANK.warning && ((a.role === "stop" && a.isNext) || a.role === "road") && a.at - nowMs <= DRIVE_ALERT_AHEAD_MS;
