// Plan vs Reality → Trip Learning. Compares what was planned with what actually happened, and turns it into a few
// plain-language observations about HOW this person travels. Rules:
//   * only what the person actually did in the app (stops marked done / skipped, when) — no location history;
//   * nothing is claimed without enough evidence (minimum counts);
//   * every insight shows its evidence, so it can be checked and ignored.
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { parseISODate, addDays } from "@/lib/dates";

export type LearnPlace = {
  name: string;
  category: string | null;
  day_number: number | null;
  status: "planned" | "done" | "skipped";
  status_at: string | null;
  /** Planned arrival, "HH:MM" or "HH:MM:SS". */
  arrival_time: string | null;
};
export type LearnTrip = { id: string; name: string; num_days: number; start_date: string | null; places: LearnPlace[] };

export type Insight = { id: string; title: string; evidence: string };
export type TripReality = {
  tripId: string;
  scheduled: number;
  done: number;
  skipped: number;
  notDone: number;
  completionRate: number | null;
  /** Median minutes later (+) / earlier (−) than planned, for stops that were marked done on their planned day. */
  medianDelayMin: number | null;
  delaySamples: number;
};
export type Learning = {
  trips: number;
  scheduled: number;
  done: number;
  skipped: number;
  completionRate: number | null;
  plannedPerDay: number | null;
  donePerDay: number | null;
  medianDelayMin: number | null;
  medianFirstDoneHour: number | null;
  skipByCategory: { category: string; skipped: number; total: number }[];
  insights: Insight[];
  /** True once there is enough to say anything about this person's style. */
  enough: boolean;
};

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const toMin = (hhmm: string | null) => {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const localParts = (iso: string, offsetMin: number) => {
  const d = new Date(Date.parse(iso) + offsetMin * 60_000);
  return { date: d.toISOString().slice(0, 10), minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
};
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function tripReality(trip: LearnTrip, utcOffsetMin: number): TripReality {
  const scheduled = trip.places.filter((p) => p.day_number !== null);
  const done = scheduled.filter((p) => p.status === "done");
  const skipped = scheduled.filter((p) => p.status === "skipped");
  const notDone = scheduled.length - done.length - skipped.length;
  const start = trip.start_date ? parseISODate(trip.start_date) : null;

  // "Marked done" is when the person tapped Done, so compare it with the planned arrival PLUS the usual stay.
  const delays: number[] = [];
  for (const p of done) {
    const planned = toMin(p.arrival_time);
    if (!start || planned === null || !p.status_at || p.day_number === null) continue;
    const at = localParts(p.status_at, utcOffsetMin);
    if (at.date !== isoDay(addDays(start, p.day_number - 1))) continue; // marked on another day: not comparable
    delays.push(at.minute - (planned + Math.round(CATEGORIES[normalizeCategory(p.category)].hours * 60)));
  }
  return {
    tripId: trip.id,
    scheduled: scheduled.length,
    done: done.length,
    skipped: skipped.length,
    notDone,
    completionRate: scheduled.length > 0 ? done.length / scheduled.length : null,
    medianDelayMin: delays.length >= 3 ? Math.round(median(delays)!) : null,
    delaySamples: delays.length,
  };
}

export function learnFromTrips(trips: LearnTrip[], utcOffsetMin: number): Learning {
  const all = trips.flatMap((t) => t.places.filter((p) => p.day_number !== null).map((p) => ({ ...p, trip: t })));
  const done = all.filter((p) => p.status === "done");
  const skipped = all.filter((p) => p.status === "skipped");

  // Stops per day (only days where something was actually marked, so unvisited future days don't drag the average down).
  const plannedByDay = new Map<string, number>();
  const doneByDay = new Map<string, number>();
  const firstDone = new Map<string, number>();
  for (const p of all) {
    const key = `${p.trip.id}:${p.day_number}`;
    plannedByDay.set(key, (plannedByDay.get(key) ?? 0) + 1);
  }
  for (const p of done) {
    const key = `${p.trip.id}:${p.day_number}`;
    doneByDay.set(key, (doneByDay.get(key) ?? 0) + 1);
    if (p.status_at) {
      const m = localParts(p.status_at, utcOffsetMin).minute;
      firstDone.set(key, Math.min(firstDone.get(key) ?? 1e9, m));
    }
  }
  const activeDays = [...doneByDay.keys()];
  const plannedPerDay = activeDays.length ? activeDays.reduce((s, k) => s + (plannedByDay.get(k) ?? 0), 0) / activeDays.length : null;
  const donePerDay = activeDays.length ? activeDays.reduce((s, k) => s + (doneByDay.get(k) ?? 0), 0) / activeDays.length : null;

  const delays = trips.map((t) => tripReality(t, utcOffsetMin)).flatMap((r) => (r.medianDelayMin !== null ? Array(r.delaySamples).fill(r.medianDelayMin) : []));
  const medianDelay = delays.length >= 3 ? Math.round(median(delays)!) : null;
  const firstHours = [...firstDone.values()].filter((m) => m < 1e9);
  const medianFirst = firstHours.length >= 3 ? median(firstHours)! / 60 : null;

  const cat = new Map<string, { skipped: number; total: number }>();
  for (const p of all) {
    if (p.status === "planned") continue; // undecided stops tell us nothing
    const c = normalizeCategory(p.category);
    const e = cat.get(c) ?? { skipped: 0, total: 0 };
    e.total++;
    if (p.status === "skipped") e.skipped++;
    cat.set(c, e);
  }
  const skipByCategory = [...cat.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.skipped - a.skipped);

  const enough = done.length >= 4;
  const insights: Insight[] = [];
  if (enough) {
    if (plannedPerDay !== null && donePerDay !== null && activeDays.length >= 2 && donePerDay <= plannedPerDay * 0.75) {
      insights.push({ id: "packed", title: "Your plans tend to be more packed than you enjoy", evidence: `You planned ${r1(plannedPerDay)} stops a day and finished ${r1(donePerDay)} (over ${activeDays.length} days).` });
    } else if (donePerDay !== null && activeDays.length >= 2 && donePerDay <= 2.5) {
      insights.push({ id: "relaxed-pace", title: "You prefer a relaxed pace", evidence: `You complete about ${r1(donePerDay)} stops a day.` });
    }
    if (medianDelay !== null && medianDelay >= 30) insights.push({ id: "behind", title: "You usually run behind the plan", evidence: `Stops were marked done a median of ${medianDelay} min later than planned (${delays.length} stops).` });
    else if (medianDelay !== null && medianDelay <= 10 && delays.length >= 5) insights.push({ id: "on-time", title: "You keep close to your schedule", evidence: `A median of ${medianDelay <= 0 ? `${-medianDelay} min early` : `${medianDelay} min late`} across ${delays.length} stops.` });
    if (medianFirst !== null && medianFirst >= 11) insights.push({ id: "slow-mornings", title: "You like relaxed mornings", evidence: `Your first stop of the day is usually marked done around ${Math.floor(medianFirst)}:${String(Math.round((medianFirst % 1) * 60)).padStart(2, "0")} (${firstHours.length} days).` });
    else if (medianFirst !== null && medianFirst <= 9) insights.push({ id: "early", title: "You start early", evidence: `Your first stop of the day is usually done by ${Math.floor(medianFirst)}:${String(Math.round((medianFirst % 1) * 60)).padStart(2, "0")} (${firstHours.length} days).` });
    for (const c of skipByCategory) {
      if (c.total >= 3 && c.skipped / c.total >= 0.5) insights.push({ id: `skips-${c.category}`, title: `You often skip ${CATEGORIES[c.category as keyof typeof CATEGORIES]?.label.toLowerCase() ?? c.category} stops`, evidence: `${c.skipped} of ${c.total} were skipped.` });
    }
    if (all.length >= 6 && done.length / all.length >= 0.9) insights.push({ id: "sticks", title: "You stick to the plan", evidence: `${done.length} of ${all.length} planned stops were completed.` });
  }

  return {
    trips: trips.length,
    scheduled: all.length,
    done: done.length,
    skipped: skipped.length,
    completionRate: all.length ? done.length / all.length : null,
    plannedPerDay: plannedPerDay === null ? null : r1(plannedPerDay),
    donePerDay: donePerDay === null ? null : r1(donePerDay),
    medianDelayMin: medianDelay,
    medianFirstDoneHour: medianFirst === null ? null : r1(medianFirst),
    skipByCategory,
    insights,
    enough,
  };
}
