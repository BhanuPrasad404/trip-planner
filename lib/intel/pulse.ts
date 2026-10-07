// Live Place Pulse: what is known about a place RIGHT NOW, and how much to trust each piece.
// Every signal says where it came from and how old it is; "historical" is never presented as live;
// disagreements are shown, not smoothed over; and anything we do not know is listed as unknown — never filled in.
import { openStatus } from "./hours";
import { REPORT_TAGS, type ReportTag } from "@/lib/reports";
import type { HourlyWeather } from "@/lib/providers/types";

export type PulseSource = "map-data" | "forecast" | "recent" | "community" | "historical";
export type PulseTrust = "high" | "medium" | "low";

export type PulseSignal = {
  id: string;
  title: string;
  value: string;
  source: PulseSource;
  trust: PulseTrust;
  observedAt: string | null;
  ageText: string | null;
  detail?: string;
};
export type PulseConflict = { id: string; title: string; detail: string };
export type PulsePhoto = { url: string; ageText: string; tags: string[] };
export type Pulse = { signals: PulseSignal[]; conflicts: PulseConflict[]; gaps: string[]; photos: PulsePhoto[]; lastUpdateAt: string | null };

export type PulseReport = { user_id: string; tags: string[]; note: string | null; photo_path: string | null; created_at: string };

export function ageText(nowMs: number, iso: string): string {
  const mins = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  return `${Math.floor(d / 30)} months ago`;
}

const HOUR = 3_600_000;
const label = (t: string) => (t in REPORT_TAGS ? REPORT_TAGS[t as ReportTag].label : t);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

type Args = {
  hours: string | null;
  /** When our map data for this place was last fetched. */
  hoursCheckedAt: string | null;
  weather: HourlyWeather | null;
  reports: PulseReport[];
  photoUrl: (path: string) => string;
  nowMs: number;
  utcOffsetMin: number;
};

/** Distinct people who reported `tag` in the window, and the time of the latest such report. */
function tally(reports: PulseReport[], tag: string, fromMs: number, toMs: number) {
  const users = new Set<string>();
  let latest: string | null = null;
  for (const r of reports) {
    const t = Date.parse(r.created_at);
    if (t < fromMs || t > toMs || !r.tags.includes(tag)) continue;
    users.add(r.user_id);
    if (!latest || r.created_at > latest) latest = r.created_at;
  }
  return { n: users.size, latest };
}

export function buildPulse(a: Args): Pulse {
  const { nowMs } = a;
  const signals: PulseSignal[] = [];
  const conflicts: PulseConflict[] = [];
  const gaps: string[] = [];

  // 1. Opening — from map data (OpenStreetMap), which is NOT an official source, so it is labelled that way.
  let openNow: "open" | "closed" | "unknown" = "unknown";
  if (a.hours) {
    const st = openStatus(a.hours, nowMs, a.utcOffsetMin);
    openNow = st.state;
    signals.push({
      id: "hours",
      title: "Opening",
      value: st.state === "open" ? `Open${st.at ? ` until ${st.at}` : ""}` : st.state === "closed" ? `Closed now${st.at ? ` (opens ${st.at})` : ""}` : "Hours are listed but too complex to read automatically",
      source: "map-data",
      trust: st.state === "unknown" ? "low" : "medium",
      observedAt: a.hoursCheckedAt,
      ageText: a.hoursCheckedAt ? `map data checked ${ageText(nowMs, a.hoursCheckedAt)}` : null,
      detail: `“${a.hours.slice(0, 80)}” — from OpenStreetMap, not an official listing.`,
    });
  } else {
    gaps.push("Official opening hours are not available for this place.");
  }

  // 2. Weather — a forecast for the current hour.
  if (a.weather) {
    const p = a.weather.precipProb;
    signals.push({
      id: "weather",
      title: "Weather",
      value: `${Math.round(a.weather.tempC)}°C · ${p !== null ? `${Math.round(p)}% chance of rain` : a.weather.precipMm > 0 ? `${a.weather.precipMm} mm rain` : "no rain forecast"}`,
      source: "forecast",
      trust: "high",
      observedAt: a.weather.time,
      ageText: `forecast for ${new Date(a.weather.time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC hour`,
    });
  } else {
    gaps.push("Live weather is unavailable right now.");
  }

  // 3. Traveler reports: RECENT (≤ 6 h), then COMMUNITY (≤ 7 days).
  const tags = new Set(a.reports.flatMap((r) => r.tags));
  for (const tag of tags) {
    const recent = tally(a.reports, tag, nowMs - 6 * HOUR, nowMs);
    if (recent.n > 0 && recent.latest) {
      signals.push({
        id: `recent-${tag}`,
        title: label(tag),
        value: `${plural(recent.n, "traveler")} reported this in the last 6 hours`,
        source: "recent",
        trust: recent.n >= 2 ? "high" : "medium",
        observedAt: recent.latest,
        ageText: ageText(nowMs, recent.latest),
      });
      continue;
    }
    const week = tally(a.reports, tag, nowMs - 7 * 24 * HOUR, nowMs - 6 * HOUR);
    if (week.n > 0 && week.latest) {
      signals.push({
        id: `community-${tag}`,
        title: label(tag),
        value: `${plural(week.n, "traveler")} reported this in the last 7 days`,
        source: "community",
        trust: week.n >= 3 ? "medium" : "low",
        observedAt: week.latest,
        ageText: `latest ${ageText(nowMs, week.latest)}`,
      });
    }
  }

  // 4. Historical crowd pattern — only from our own reports, only with enough observations.
  const crowdReports = a.reports.filter((r) => r.tags.includes("crowded") || r.tags.includes("quiet"));
  const days = new Set(crowdReports.map((r) => r.created_at.slice(0, 10)));
  if (crowdReports.length >= 5 && days.size >= 3) {
    const crowded = crowdReports.filter((r) => r.tags.includes("crowded")).length;
    signals.push({
      id: "historical-crowd",
      title: "Typical crowd",
      value: crowded / crowdReports.length >= 0.6 ? `Usually crowded (${crowded} of ${crowdReports.length} reports)` : crowded / crowdReports.length <= 0.4 ? `Usually quiet (${crowdReports.length - crowded} of ${crowdReports.length} reports)` : `Mixed (${crowded} crowded, ${crowdReports.length - crowded} quiet)`,
      source: "historical",
      trust: "low",
      observedAt: null,
      ageText: `from reports over the last ${Math.max(...[...days].map((d) => Math.ceil((nowMs - Date.parse(d)) / (24 * HOUR))))} days`,
      detail: "A pattern from past traveler reports — not live information.",
    });
  } else {
    gaps.push("Typical crowd pattern: not enough past reports yet.");
  }
  if (!a.reports.some((r) => (r.tags.includes("crowded") || r.tags.includes("quiet")) && nowMs - Date.parse(r.created_at) <= 24 * HOUR)) {
    gaps.push("Live crowd information is unavailable.");
  }
  gaps.push("Parking details are unavailable.");

  // 5. Conflicts — surfaced, never hidden.
  const closed3h = tally(a.reports, "closed", nowMs - 3 * HOUR, nowMs);
  if (openNow === "open" && closed3h.n >= 2 && closed3h.latest) {
    conflicts.push({ id: "open-vs-closed", title: "Information conflict", detail: `Map data says open, but ${plural(closed3h.n, "traveler")} reported it closed ${ageText(nowMs, closed3h.latest)}.` });
  }
  const pairs: [string, string, number][] = [["water_flowing", "dry", 48], ["crowded", "quiet", 3], ["road_good", "road_bad", 24]];
  for (const [x, y, hrs] of pairs) {
    const tx = tally(a.reports, x, nowMs - hrs * HOUR, nowMs);
    const ty = tally(a.reports, y, nowMs - hrs * HOUR, nowMs);
    if (tx.n > 0 && ty.n > 0) conflicts.push({ id: `${x}-vs-${y}`, title: "Travelers disagree", detail: `${plural(tx.n, "traveler")} said “${label(x)}”, ${plural(ty.n, "traveler")} said “${label(y)}” in the last ${hrs} h.` });
  }

  // 6. Real photos only, newest first.
  const photos: PulsePhoto[] = [...a.reports]
    .filter((r) => r.photo_path)
    .sort((p, q) => q.created_at.localeCompare(p.created_at))
    .slice(0, 5)
    .map((r) => ({ url: a.photoUrl(r.photo_path!), ageText: ageText(nowMs, r.created_at), tags: r.tags.map(label) }));

  const times = signals.filter((s) => (s.source === "recent" || s.source === "community") && s.observedAt).map((s) => s.observedAt!);
  const lastUpdateAt = times.sort().reverse()[0] ?? null;

  // Most trustworthy and freshest first.
  const rank = { recent: 0, forecast: 1, "map-data": 2, community: 3, historical: 4 } as const;
  signals.sort((p, q) => rank[p.source] - rank[q.source]);
  return { signals, conflicts, gaps, photos, lastUpdateAt };
}
