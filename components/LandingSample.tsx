"use client";

import { useState } from "react";
import { SeasonBadge } from "./SeasonBadge";
import { SAMPLE_MONTHS, monthName, type SampleStop } from "@/lib/landing-sample";

/**
 * The landing page's example: a real route from our season data, with a month switch so the visitor sees the point of the app —
 * the same places are a good or a poor choice depending on WHEN you go. Every badge and reason comes from the data (passed in).
 */
export function LandingSample({ byMonth }: { byMonth: Record<number, SampleStop[]> }) {
  const [month, setMonth] = useState<number>(SAMPLE_MONTHS[0]);
  const stops = byMonth[month] ?? [];
  const good = stops.filter((s) => s.status === "good").length;
  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-2xl shadow-pine/20 ring-1 ring-line">
      <div className="bg-pine px-5 py-4 text-white">
        <p className="text-xs font-semibold uppercase tracking-widest text-white/75">Example route · 2 days</p>
        <p className="mt-1 font-display text-2xl font-semibold">Hyderabad → Warangal → Bogatha</p>
        <div role="group" aria-label="If you go in" className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-white/80">If you go in:</span>
          {SAMPLE_MONTHS.map((m) => (
            <button key={m} type="button" aria-pressed={month === m} onClick={() => setMonth(m)}
              className={`min-h-9 rounded-full px-3.5 font-semibold ${month === m ? "bg-marigold text-pine" : "bg-white/10 text-white hover:bg-white/20"}`}>
              {monthName(m)}
            </button>
          ))}
        </div>
      </div>
      <p aria-live="polite" className="border-b border-line px-5 py-2.5 text-sm text-ink-muted">
        In {monthName(month)}, {good} of {stops.length} stops are in season.
      </p>
      <ol className="px-5 py-1">
        {stops.map((s) => (
          <li key={s.name} className="border-b border-line py-3.5 last:border-b-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-base font-semibold">{s.name}</p>
              <SeasonBadge status={s.status} />
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">{s.kind} · {s.region} · best {s.window}</p>
            <p className="mt-1.5 text-sm text-ink-muted">{s.reason}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
