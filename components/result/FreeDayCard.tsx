// A trip day with nothing planned. Said plainly, so a missing number never looks like a bug.
import type { FreeDay } from "@/lib/result/free-days";

export function FreeDayCard({ f }: { f: FreeDay }) {
  return (
    <article aria-labelledby={`day-${f.day}`} className="rounded-2xl border border-dashed border-line bg-white p-4">
      <header className="flex items-baseline justify-between gap-3">
        <h3 id={`day-${f.day}`} className="font-display text-lg font-semibold text-pine">Day {f.day}</h3>
        <span className="shrink-0 text-sm text-ink-muted">Free day</span>
      </header>
      <p className="mt-1 text-sm text-ink-muted">{f.trailing ? "Your plan is finished before this day. Rest, or add more places to use it." : "Nothing is planned for this day. Rest, or add a place."}</p>
    </article>
  );
}
