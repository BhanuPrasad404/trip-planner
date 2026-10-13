"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/Field";
import { Glyph } from "@/components/ui/Glyph";
import { useAction } from "@/lib/client/use-action";
import { MAX_TRIP_DAYS_ALLOWED, MIN_TRIP_DAYS, previewDateChange, summarizeTripDates } from "@/lib/trip-dates";

/**
 * "When are you going?" — the trip's dates, always visible, and editable by the owner.
 * Everything date-based on the page (which season you are in, weather, the Go score, day labels) follows these dates.
 */
export function TripDatesPanel({ tripId, startDate, numDays, canEdit, stopCountsByDay, onChanged }: {
  tripId: string;
  startDate: string | null;
  numDays: number;
  canEdit: boolean;
  /** Scheduled stops on each day, to warn before a shorter trip sends some of them back to Ideas. */
  stopCountsByDay: Record<number, number>;
  onChanged: () => void;
}) {
  const summary = summarizeTripDates(startDate, numDays);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(startDate ?? "");
  const [days, setDays] = useState(summary.days);

  const preview = previewDateChange({ startDate: date || null, numDays: days, currentStart: startDate, currentDays: summary.days, countsByDay: stopCountsByDay });
  const save = useAction(async () => {
    const res = await fetch(`/api/trips/${tripId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_date: date || null, num_days: days }),
    });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new Error(body?.error ?? "We couldn't change the dates. Please try again.");
    setEditing(false);
    onChanged();
  }, { fallbackError: "We couldn't change the dates. Please try again." });

  const open = () => { setDate(startDate ?? ""); setDays(summary.days); save.clearError(); setEditing(true); };
  const step = (delta: number) => setDays((d) => Math.min(MAX_TRIP_DAYS_ALLOWED, Math.max(MIN_TRIP_DAYS, (Number.isFinite(d) ? d : summary.days) + delta)));

  return (
    <section aria-labelledby="dates-heading" className="rounded-3xl border border-line bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-teal-light text-teal-ink"><Glyph name="calendar" size={20} /></span>
          <div className="min-w-0">
            <h2 id="dates-heading" className="font-mono text-[11px] font-semibold uppercase tracking-widest text-ink-muted">Trip dates</h2>
            <p className="font-display text-lg font-semibold leading-snug text-pine">{summary.rangeLabel}</p>
            <p className="text-sm text-ink-muted">
              {summary.hasDates
                ? `${summary.days} ${summary.days === 1 ? "day" : "days"}. Season, weather and Go scores below are worked out for these dates.`
                : `${summary.days} ${summary.days === 1 ? "day" : "days"}. Without dates, scores below use today's season, not your trip. Add your dates for accurate season and weather.`}
            </p>
          </div>
        </div>
        {canEdit && !editing && <Button variant="secondary" size="sm" onClick={open}><Glyph name="calendar" size={15} />{summary.hasDates ? "Change dates" : "Add dates"}</Button>}
        {!canEdit && <p className="text-xs text-ink-muted">Only the trip owner can change the dates.</p>}
      </div>

      {editing && (
        <form className="mt-4 space-y-4 rounded-2xl border border-line bg-sky/50 p-4" onSubmit={(e) => { e.preventDefault(); if (preview.valid && preview.changed) void save.run(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="trip-start-date" className="text-sm font-semibold text-pine">First day of the trip</label>
              <input id="trip-start-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1.5 min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base" />
              {date && <button type="button" onClick={() => setDate("")} className="mt-1.5 min-h-8 text-sm font-semibold text-ink-muted underline underline-offset-2 hover:text-clay-ink">Clear the date</button>}
            </div>
            <div>
              <span id="trip-days-label" className="text-sm font-semibold text-pine">How many days?</span>
              <div role="group" aria-labelledby="trip-days-label" className="mt-1.5 inline-flex items-center overflow-hidden rounded-xl border border-line bg-white">
                <button type="button" onClick={() => step(-1)} disabled={days <= MIN_TRIP_DAYS} aria-label="One day fewer" className="grid h-12 w-12 place-items-center text-xl font-semibold text-pine hover:bg-sky disabled:opacity-40">−</button>
                <input aria-label="Number of days" type="number" inputMode="numeric" min={MIN_TRIP_DAYS} max={MAX_TRIP_DAYS_ALLOWED} value={Number.isFinite(days) ? days : ""} onChange={(e) => setDays(e.target.value === "" ? NaN : Number(e.target.value))} className="h-12 w-16 border-x border-line bg-white text-center font-mono text-lg font-semibold" />
                <button type="button" onClick={() => step(1)} disabled={days >= MAX_TRIP_DAYS_ALLOWED} aria-label="One day more" className="grid h-12 w-12 place-items-center text-xl font-semibold text-pine hover:bg-sky disabled:opacity-40">+</button>
              </div>
            </div>
          </div>

          <p className="text-sm text-ink-muted" aria-live="polite">
            {preview.valid
              ? preview.endLabel ? <>The trip would run <strong className="text-pine">{days} {days === 1 ? "day" : "days"}</strong> and end on <strong className="text-pine">{preview.endLabel}</strong>.</> : <>The trip would have <strong className="text-pine">{days} {days === 1 ? "day" : "days"}</strong> and no fixed dates.</>
              : <span className="font-semibold text-clay-ink">{preview.problem}</span>}
          </p>

          {preview.valid && preview.movingToIdeas > 0 && (
            <p role="note" className="flex items-start gap-2 rounded-xl border border-marigold/50 bg-marigold-light/70 px-3 py-2.5 text-sm text-[#7a4a00]">
              <Glyph name="warn" size={16} className="mt-0.5" />
              <span><strong>{preview.movingToIdeas} {preview.movingToIdeas === 1 ? "stop" : "stops"}</strong> on the days that would disappear will go back to your Ideas. Nothing is deleted, and you can schedule them again.</span>
            </p>
          )}

          <FormError message={save.error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" disabled={save.pending} onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" loading={save.pending} loadingLabel="Saving…" disabled={!preview.valid || !preview.changed}>Save dates</Button>
          </div>
        </form>
      )}
    </section>
  );
}
