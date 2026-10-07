import type { Learning } from "@/lib/learning";

/** "Your travel style": only what the person's own trips show, each with its evidence — and honest when there isn't enough yet. */
export function TravelStyle({ learning, compact = false }: { learning: Learning; compact?: boolean }) {
  return (
    <section aria-labelledby="style-heading" className="rounded-2xl border border-line bg-white p-5">
      <h2 id="style-heading" className="font-display text-lg font-semibold text-pine">Your travel style</h2>
      {!learning.enough ? (
        <p className="mt-2 text-sm text-ink-muted">
          Not enough yet. As you travel, tap <strong>Done</strong> or <strong>Skip</strong> on stops, and after a few completed stops we&apos;ll compare what you planned with what you actually did.
          {learning.scheduled > 0 && <> So far: {learning.done} done, {learning.skipped} skipped.</>}
        </p>
      ) : learning.insights.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">You&apos;ve completed {learning.done} stops, but nothing stands out as a clear pattern yet. That&apos;s fine — it means your plans and your travel match.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {learning.insights.slice(0, compact ? 3 : 8).map((i) => (
            <li key={i.id}><p className="font-semibold text-pine">{i.title}</p><p className="text-sm text-ink-muted">{i.evidence}</p></li>
          ))}
        </ul>
      )}
      {learning.enough && (
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm sm:grid-cols-4">
          <div><dt className="text-ink-muted">Stops completed</dt><dd className="font-display text-xl font-semibold text-pine">{learning.done}<span className="text-sm font-normal text-ink-muted"> / {learning.scheduled}</span></dd></div>
          <div><dt className="text-ink-muted">Per day</dt><dd className="font-display text-xl font-semibold text-pine">{learning.donePerDay ?? "—"}<span className="text-sm font-normal text-ink-muted"> of {learning.plannedPerDay ?? "—"} planned</span></dd></div>
          <div><dt className="text-ink-muted">Timing vs plan</dt><dd className="font-display text-xl font-semibold text-pine">{learning.medianDelayMin === null ? "—" : `${learning.medianDelayMin > 0 ? "+" : ""}${learning.medianDelayMin} min`}</dd></div>
          <div><dt className="text-ink-muted">Usual first stop</dt><dd className="font-display text-xl font-semibold text-pine">{learning.medianFirstDoneHour === null ? "—" : `${Math.floor(learning.medianFirstDoneHour)}:${String(Math.round((learning.medianFirstDoneHour % 1) * 60)).padStart(2, "0")}`}</dd></div>
        </dl>
      )}
      <p className="mt-3 text-[11px] text-ink-muted">Based only on stops you marked done or skipped. We don&apos;t keep a history of where you have been. Times are when you tapped Done.</p>
    </section>
  );
}
