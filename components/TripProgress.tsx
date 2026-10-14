import { Glyph } from "@/components/ui/Glyph";
import type { Vehicle } from "@/lib/vehicle";

const ICON = { car: "car", motorcycle: "motorbike", bus: "bus" } as const;
export type ProgressStop = { id: string; name: string; status: "planned" | "done" | "skipped" };

/**
 * Today's progress, from the real state of each stop. The bar and the little vehicle move ONLY when a stop is marked (done or skipped);
 * they are not a looping decoration. Nothing here is estimated: it is "N of M stops", the next stop and, when we have it, the real distance.
 */
export function TripProgress({ stops, vehicle, nextName, nextKm }: { stops: ProgressStop[]; vehicle: Vehicle; nextName: string | null; nextKm: number | null }) {
  const counted = stops.filter((s) => s.status !== "skipped");
  const done = counted.filter((s) => s.status === "done").length;
  const total = counted.length;
  const skipped = stops.length - total;
  if (stops.length === 0) return null;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <section aria-labelledby="progress-heading" className="rounded-2xl border border-line bg-white p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="progress-heading" className="text-sm font-semibold text-pine">Today&apos;s progress</h2>
        <p className="text-sm text-ink-muted"><strong className="text-pine">{done} of {total}</strong> {total === 1 ? "stop" : "stops"} done{skipped > 0 ? ` · ${skipped} skipped` : ""}</p>
      </div>
      <div className="relative mt-3 px-3" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={`${done} of ${total} stops done`}>
        <div className="relative h-2 rounded-full bg-sky">
          <div className="absolute inset-y-0 left-0 rounded-full bg-teal transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${pct}%` }} />
          <span className="absolute top-1/2 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-teal-ink shadow ring-2 ring-teal transition-[left] duration-700 ease-out motion-reduce:transition-none" style={{ left: `${pct}%` }}><Glyph name={ICON[vehicle]} size={16} /></span>
        </div>
        <ol className="mt-3 flex justify-between" aria-label="Stops today">
          {stops.map((s) => (
            <li key={s.id} className="flex min-w-0 flex-1 justify-center"><span title={s.name} className={`h-2.5 w-2.5 rounded-full border-2 ${s.status === "done" ? "border-teal bg-teal" : s.status === "skipped" ? "border-line bg-line" : "border-ink-muted/50 bg-white"}`}><span className="sr-only">{s.name}: {s.status === "done" ? "done" : s.status === "skipped" ? "skipped" : "still to do"}</span></span></li>
          ))}
        </ol>
      </div>
      {nextName && <p className="mt-2 text-sm text-ink-muted">Next: <strong className="text-pine">{nextName}</strong>{nextKm !== null ? ` · ${nextKm < 10 ? nextKm.toFixed(1) : Math.round(nextKm)} km` : ""}</p>}
      {!nextName && done === total && total > 0 && <p className="mt-2 text-sm font-semibold text-teal-ink">That&apos;s every stop for today.</p>}
    </section>
  );
}
