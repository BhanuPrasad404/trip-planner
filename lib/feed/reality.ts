// "What is it like right now?" — turned from raw traveler reports into claims that are only as strong as the evidence.
//  * One report is shown as ONE traveler's report, never as "usually quiet".
//  * Every kind of report expires on its own clock (a queue in hours, a closure in a day).
//  * Counts are always shown with the claim, so the reader can judge it.
import { CONDITIONS, conditionLabel, conditionTtlMs, CROWD_LABEL, CROWD_LEVELS, CROWD_TTL_HOURS, vibeLabel, WARNING_CONDITIONS, type CrowdLevel } from "./experience";

export type PulseRaw = {
  total_30d: number; posts_24h: number; posts_7d: number; videos_7d: number; contributors_7d: number; from_area_7d: number; trip_adds_30d: number;
  crowd: { level: string; at: string }[];
  conditions: { id: string; at: string }[];
  vibes: { id: string; n: number }[];
  tips: { text: string; at: string; by: string | null }[];
};

export type CrowdReading = {
  /** Only set when enough RECENT travelers agree. Otherwise null and `note` says what we do know. */
  level: CrowdLevel | null;
  confidence: "none" | "low" | "good";
  /** How many travelers reported in the last 24 h, and how many of them said the winning level. */
  recent: number;
  agreeing: number;
  counts: Record<CrowdLevel, number>;
  note: string;
};
export type ConditionReading = { id: string; label: string; reports: number; lastAt: string; ageMs: number; warning: boolean };
export type Reality = {
  activity: { today: number; week: number; videos: number; contributors: number; fromArea: number; tripAdds: number; total30d: number };
  crowd: CrowdReading;
  conditions: ConditionReading[];
  vibes: { id: string; label: string; n: number }[];
  tips: { text: string; at: string; by: string | null }[];
  /** True when there is nothing recent at all: the screen then says so plainly instead of showing empty panels. */
  quiet: boolean;
};

const HOUR = 3_600_000;
const ago = (ms: number) => { const h = Math.round(ms / HOUR); return ms < 2 * HOUR ? "in the last hour" : h < 24 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`; };
const isCrowd = (l: string): l is CrowdLevel => (CROWD_LEVELS as readonly string[]).includes(l);

export function readCrowd(reports: PulseRaw["crowd"], nowMs: number): CrowdReading {
  const counts: Record<CrowdLevel, number> = { quiet: 0, moderate: 0, crowded: 0 };
  const all = reports.filter((r) => isCrowd(r.level)).map((r) => ({ level: r.level as CrowdLevel, age: Math.max(0, nowMs - Date.parse(r.at)) })).filter((r) => Number.isFinite(r.age));
  const recent = all.filter((r) => r.age <= CROWD_TTL_HOURS * HOUR);
  for (const r of recent) counts[r.level]++;
  if (recent.length === 0) {
    return { level: null, confidence: "none", recent: 0, agreeing: 0, counts, note: all.length > 0 ? `No crowd reports in the last day (${all.length} in the last 3 days).` : "No crowd reports yet." };
  }
  if (recent.length === 1) {
    return { level: null, confidence: "low", recent: 1, agreeing: 1, counts, note: `One traveler said ${CROWD_LABEL[recent[0].level].toLowerCase()} ${ago(recent[0].age)}. Not enough yet to call it.` };
  }
  // Newer reports count for more: a report from this morning outweighs one from last night (half-life 6 h).
  const weight: Record<CrowdLevel, number> = { quiet: 0, moderate: 0, crowded: 0 };
  for (const r of recent) weight[r.level] += Math.pow(0.5, r.age / (6 * HOUR));
  const total = weight.quiet + weight.moderate + weight.crowded;
  const top = (Object.keys(weight) as CrowdLevel[]).reduce((a, b) => (weight[b] > weight[a] ? b : a));
  if (weight[top] / total <= 0.5) return { level: null, confidence: "low", recent: recent.length, agreeing: counts[top], counts, note: `Mixed reports from ${recent.length} travelers in the last day.` };
  const agreeing = counts[top];
  return { level: top, confidence: recent.length >= 3 ? "good" : "low", recent: recent.length, agreeing, counts, note: `${agreeing} of ${recent.length} travelers in the last day say ${CROWD_LABEL[top].toLowerCase()}.` };
}

export function readConditions(reports: PulseRaw["conditions"], nowMs: number): ConditionReading[] {
  const by = new Map<string, { reports: number; lastAt: string; lastMs: number }>();
  for (const r of reports) {
    const t = Date.parse(r.at);
    if (!Number.isFinite(t) || !CONDITIONS.some((c) => c.id === r.id)) continue;
    if (nowMs - t > conditionTtlMs(r.id)) continue;                         // expired: this kind of report has gone stale
    const cur = by.get(r.id) ?? { reports: 0, lastAt: r.at, lastMs: t };
    cur.reports++;
    if (t > cur.lastMs) { cur.lastAt = r.at; cur.lastMs = t; }
    by.set(r.id, cur);
  }
  return [...by].map(([id, v]) => ({ id, label: conditionLabel(id), reports: v.reports, lastAt: v.lastAt, ageMs: Math.max(0, nowMs - v.lastMs), warning: WARNING_CONDITIONS.has(id) }))
    .sort((a, b) => a.ageMs - b.ageMs);
}

export function summarizeReality(raw: PulseRaw, nowMs: number): Reality {
  const crowd = readCrowd(raw.crowd ?? [], nowMs);
  const conditions = readConditions(raw.conditions ?? [], nowMs);
  return {
    activity: { today: raw.posts_24h ?? 0, week: raw.posts_7d ?? 0, videos: raw.videos_7d ?? 0, contributors: raw.contributors_7d ?? 0, fromArea: raw.from_area_7d ?? 0, tripAdds: raw.trip_adds_30d ?? 0, total30d: raw.total_30d ?? 0 },
    crowd, conditions,
    vibes: (raw.vibes ?? []).map((v) => ({ id: v.id, label: vibeLabel(v.id), n: v.n })),
    tips: (raw.tips ?? []).slice(0, 3),
    quiet: (raw.posts_7d ?? 0) === 0,
  };
}

export const agoText = ago;
