// How the weather is SAID on screen: one place for the words, so every card, line and alert reads the same. Pure.
//   • the time the traveller will be there is the main text ("Arrive 6:20 PM"); the forecast step it comes from is small and
//     secondary ("forecast for 6:30 PM"), never rounded to a wrong hour
//   • "Hot" and the other hazard words come only from that moment's forecast (lib/forecast/moment.ts); a day's maximum never says it
//   • day parts show the rain chance and a hazard word; heat in a part is a number ("feels 36°"), not a word, because the traveller may
//     not be there at that hour
import { INDIA_UTC_OFFSET_MIN, dateOf, dayShiftLabel, time12 } from "@/lib/travel/clock";
import type { GlyphName } from "@/lib/glyphs";
import { SEVERITY_WORD, isRainLikely, type Severity, type WeatherKind } from "@/lib/weather-rules";
import type { WeatherAlert } from "./alerts";
import type { BoardPlace } from "./board";
import type { DayPart } from "./day-parts";
import type { Moment, MomentMissing } from "./moment";
import { dayWord } from "./day-summary";

const off = INDIA_UTC_OFFSET_MIN;
const day = (ms: number) => new Date(ms + off * 60_000).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** The main line of a card: when the traveller will be there. */
export function timeText(p: Pick<BoardPlace, "role" | "timing">, nowMs: number): string {
  // A stop with a day but no arrival time shows that whole day (lib/forecast/day-summary.ts): "Tomorrow · all day". Only a stop with no
  // day at all has nothing to show.
  if (p.timing.status === "no-time") return p.timing.dayISO ? `${dayWord(p.timing.dayISO, nowMs)} · all day` : "No arrival time set";
  const { at, basis } = p.timing;
  const clock = time12(at, off);
  const shift = dayShiftLabel(nowMs, at, off);
  const when = shift === null ? (dateOf(at, off) === dateOf(nowMs, off) ? clock : `${day(at)}, ${clock}`) : shift === "next day" ? `tomorrow ${clock}` : `${day(at)}, ${clock}`;
  if (basis === "now") return "Now";
  if (basis === "picked") return `At ${when}`;
  if (basis === "planned") return `Arrive ${when} (planned)`;
  return `Arrive ${when}`;
}

/** The small secondary line: which forecast step the numbers are from. */
export const stepText = (m: Moment) => `forecast for ${time12(m.shownAt, off)}`;

export const dayNightWord = (isDay: boolean | null) => (isDay === true ? "Day" : isDay === false ? "Night" : null);

/** "10% rain", "about 3 mm rain", or nothing when the forecast does not say. */
export function rainText(m: Pick<Moment, "precipProb" | "precipMm">): string | null {
  if (m.precipProb !== null) return `${Math.round(m.precipProb)}% rain`;
  if (m.precipMm !== null) return m.precipMm >= 0.1 ? `about ${Math.round(m.precipMm * 10) / 10} mm rain` : "no rain";
  return null;
}

/** The picture for a moment: the most serious hazard, else rain, else the sky by day or by night. Null when nothing is known. */
export function momentIcon(m: Moment): GlyphName | null {
  const h = m.hazards[0];
  if (h?.kind === "storm") return "storm";
  if (h?.kind === "visibility") return h.level === "watch" ? "lowVisibility" : "fog";
  if (m.precipProb !== null || m.precipMm !== null) if (isRainLikely({ precipProb: m.precipProb, precipMm: m.precipMm ?? 0 })) return "rain";
  const cloudy = m.code === 2 || m.code === 3;
  if (m.isDay === true) return cloudy ? "cloudSun" : "sun";
  if (m.isDay === false) return cloudy ? "cloudMoon" : "moon";
  return cloudy ? "cloud" : null;
}

/** The heat word for THIS moment (feels-like at this hour), or null. Never from a day's maximum. */
export const heatWord = (m: Moment) => m.hazards.find((h) => h.kind === "heat")?.label ?? null;

/** Why a place has no numbers, in words. */
export function missingText(m: MomentMissing, typical: string | null): string {
  if (m.status === "unavailable") return "Weather unavailable right now.";
  if (m.status === "beyond-forecast") return typical ?? "More than 16 days away: no forecast yet. Check again closer to the time.";
  return "No forecast for this place at that time.";
}

/** One part of the day: icon, a short word, and the rain chance. */
export function partSummary(p: DayPart): { icon: GlyphName | null; word: string; rain: string | null; feels: string | null } {
  const rain = p.rainChanceMax !== null ? `${Math.round(p.rainChanceMax)}%` : null;
  if (p.coverage === "none") return { icon: null, word: "No forecast", rain: null, feels: null };
  const w = p.worst;
  const feels = p.feelsMaxC !== null && w?.kind === "heat" ? `feels ${Math.round(p.feelsMaxC)}°` : null;
  if (w && w.kind !== "heat") return { icon: w.kind === "storm" ? "storm" : w.kind === "visibility" ? "fog" : "rain", word: w.kind === "rain" ? (w.level === "watch" ? "Rain likely" : w.label) : w.label, rain, feels };
  const dry = p.rainChanceMax !== null && p.rainChanceMax < 30;
  return { icon: w?.kind === "heat" ? "thermometer" : p.mostlyDay === false ? "moon" : "sun", word: dry ? "Dry" : p.rainChanceMax === null ? "—" : "Some rain", rain, feels };
}

export const SEVERITY_ICON: Record<Severity, GlyphName> = { watch: "watch", warning: "warn", severe: "severe" };
export const KIND_ICON: Record<WeatherKind, GlyphName> = { storm: "storm", rain: "rain", visibility: "fog", heat: "thermometer" };

/** "6:30-8:30 PM", "from 6:30 PM", for the stretch an alert lasts. */
export function windowText(a: Pick<WeatherAlert, "window">): string {
  const from = time12(a.window.from, off), to = time12(a.window.to, off);
  if (a.window.open) return `from ${from}`;
  const [f, fm] = from.split(" "), [t, tm] = to.split(" ");
  return fm === tm ? `${f}-${t} ${tm}` : `${from}-${to}`;
}

/** The one-line headline of an alert: "Heavy rain at Golconda Fort 6:30-8:30 PM". */
export const alertHeadline = (a: WeatherAlert) => `${a.label} ${a.role === "road" ? a.place : `at ${a.place}`} ${windowText(a)}`;

/** The drive-screen line: "Golconda Fort 6:30 PM · Heavy rain". */
export const driveLineText = (a: WeatherAlert) => `${a.role === "road" ? `${a.place[0].toUpperCase()}${a.place.slice(1)}` : a.place} ${time12(a.at, off)} · ${a.label.toLowerCase()}`;

export const severityWord = (s: Severity) => SEVERITY_WORD[s];

/** The "Weather" tile of the trip health strip, from the weather board (the same alerts the panel shows). */
export function weatherHealth(b: { status: string; alerts: WeatherAlert[]; places: BoardPlace[] }): { label: string; detail: string; tone: "good" | "warn" | "bad" | "unknown" } {
  if (b.status === "loading") return { label: "Checking", detail: "Getting the forecast for where you are and your stops.", tone: "unknown" };
  const any = b.places.some((p) => p.moment?.status === "ok");
  if (!any) return { label: "Unknown", detail: "Weather unavailable right now.", tone: "unknown" };
  const top = b.alerts[0];
  if (!top) return { label: "Good", detail: "No storm, fog, rain or heat alerts for where you are and your stops.", tone: "good" };
  return { label: SEVERITY_WORD[top.level], detail: alertHeadline(top), tone: top.level === "watch" ? "warn" : "bad" };
}

/**
 * What to say about the weather at a stop for an arrival moment (Trip check's departure advice and timeline): the most serious hazard
 * then, with its numbers, the source and the forecast step; or null when nothing is worth saying (or there is no forecast for then).
 */
export function arrivalNote(m: Moment | MomentMissing): { kind: WeatherKind; level: Severity; title: string; detail: string; label: string; tone: "warn" | "info" } | null {
  if (m.status !== "ok") return null;
  const h = m.hazards[0];
  if (!h) return null;
  const source = `Open-Meteo forecast for ${time12(h.kind === "rain" && m.rainTo !== null ? m.rainTo : m.shownAt, off)}`;
  const advice = h.kind === "rain" ? "Carry rain gear, or plan to arrive outside the rainy hours." : h.kind === "heat" ? "Carry water and keep time in the sun short." : h.kind === "storm" ? "Avoid exposed places, and wait for it to pass before driving through it." : "Drive slowly on low beams and keep a long gap.";
  return { kind: h.kind, level: h.level, title: h.label, label: `${h.label} (${h.detail}), ${source}`, detail: `${h.detail[0].toUpperCase()}${h.detail.slice(1)}. ${advice} ${source}.`, tone: h.level === "watch" ? "info" : "warn" };
}
