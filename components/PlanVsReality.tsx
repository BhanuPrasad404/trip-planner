"use client";

import { useSyncExternalStore } from "react";
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { addDays, parseISODate } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { tripReality, type LearnPlace, type LearnTrip } from "@/lib/learning";

const subscribe = () => () => {};
const browserOffset = () => -new Date().getTimezoneOffset();

const clock = (iso: string, offset: number) => {
  const d = new Date(Date.parse(iso) + offset * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const toMin = (hhmm: string | null) => { const m = /^(\d{2}):(\d{2})/.exec(hhmm ?? ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** What was planned vs what actually happened, stop by stop. Times are when the stop was marked done. */
export function PlanVsReality({ trip }: { trip: LearnTrip }) {
  const offset = useSyncExternalStore(subscribe, browserOffset, () => null);
  const scheduled = trip.places.filter((p) => p.day_number !== null);
  if (scheduled.length === 0) return <p className="rounded-2xl border border-dashed border-line bg-white/70 p-6 text-sm text-ink-muted">Nothing was scheduled on this trip, so there is nothing to compare.</p>;
  if (offset === null) return <div className="h-40 animate-pulse rounded-2xl bg-line/60" aria-hidden="true" />;

  const r = tripReality(trip, offset);
  const start = trip.start_date ? parseISODate(trip.start_date) : null;
  const days = Array.from({ length: trip.num_days }, (_, i) => i + 1).filter((d) => scheduled.some((p) => p.day_number === d));
  const outcome = (p: LearnPlace) => {
    if (p.status === "skipped") return { text: "Skipped", cls: "bg-sky text-ink-muted" };
    if (p.status === "planned") return { text: "Not done", cls: "bg-clay-light text-clay-ink" };
    if (!p.status_at) return { text: "Done", cls: "bg-teal-light text-teal-ink" };
    const planned = toMin(p.arrival_time);
    const at = clock(p.status_at, offset);
    if (planned === null) return { text: `Done ${at}`, cls: "bg-teal-light text-teal-ink" };
    const [h, m] = at.split(":").map(Number);
    const diff = h * 60 + m - (planned + Math.round(CATEGORIES[normalizeCategory(p.category)].hours * 60));
    return { text: `Done ${at}${Math.abs(diff) >= 15 ? ` (${diff > 0 ? "+" : ""}${diff} min vs plan)` : " (as planned)"}`, cls: "bg-teal-light text-teal-ink" };
  };

  return (
    <section aria-labelledby="pvr-heading" className="space-y-4">
      <h2 id="pvr-heading" className="font-display text-xl font-semibold text-pine">Plan vs reality</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Planned", String(r.scheduled)], ["Done", String(r.done)], ["Skipped", String(r.skipped)],
          ["Timing", r.medianDelayMin === null ? "not enough data" : `${r.medianDelayMin > 0 ? "+" : ""}${r.medianDelayMin} min`],
        ].map(([k, v]) => <div key={k} className="rounded-2xl border border-line bg-white px-4 py-3"><dt className="text-xs text-ink-muted">{k}</dt><dd className="font-display text-xl font-semibold text-pine">{v}</dd></div>)}
      </dl>
      <ol className="space-y-3">
        {days.map((d) => (
          <li key={d} className="rounded-2xl border border-line bg-white p-4">
            <p className="font-display text-lg font-semibold text-pine">Day {d}{start && <span className="ml-2 text-sm font-normal text-ink-muted">{formatDate(addDays(start, d - 1), { weekday: "short", day: "numeric", month: "short" })}</span>}</p>
            <ul className="mt-2 divide-y divide-line text-sm">
              {scheduled.filter((p) => p.day_number === d).sort((a, b) => (toMin(a.arrival_time) ?? 0) - (toMin(b.arrival_time) ?? 0)).map((p) => {
                const o = outcome(p);
                return <li key={p.name + (p.arrival_time ?? "")} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"><span className="w-12 shrink-0 font-mono text-xs text-ink-muted">{p.arrival_time?.slice(0, 5) ?? "--:--"}</span><span className="min-w-0 flex-1 break-words font-medium">{p.name}</span><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${o.cls}`}>{o.text}</span></li>;
              })}
            </ul>
          </li>
        ))}
      </ol>
      <p className="text-xs text-ink-muted">“Done” times are when you tapped Done, so they include time spent at the stop. We compare with the planned arrival plus a typical stay.</p>
    </section>
  );
}
