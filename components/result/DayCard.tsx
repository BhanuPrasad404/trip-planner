// One day of the plan as a short timeline: when the day starts, each drive (time and km), each stop (arrival time, time there, its number
// on the map), then where the night is spent. A stop is a big button that opens its actions. Details ("Why here?") stay folded.
import { Glyph } from "@/components/ui/Glyph";
import { parseISODate } from "@/lib/dates";
import type { NightHalt } from "@/lib/engine/types";
import { formatDate } from "@/lib/format";
import { duration, hhmm, type DayPlan, type PlannedStop } from "@/lib/trip-builder";

const km = (n: number) => `${Math.round(n)} km`;

export function DayCard({ d, numbers, halt, mustIds, onStop }: { d: DayPlan; numbers: Map<string, number>; halt: NightHalt | null; mustIds: Set<string>; onStop?: (s: PlannedStop) => void }) {
  const date = d.date ? parseISODate(d.date) : null;
  return (
    <article aria-labelledby={`day-${d.day}`} className="rounded-2xl border border-line bg-white p-4">
      <header className="flex items-baseline justify-between gap-3">
        <h3 id={`day-${d.day}`} className="font-display text-lg font-semibold text-pine">
          Day {d.day}{date && <span className="ml-2 text-sm font-normal text-ink-muted">{formatDate(date, { weekday: "short", day: "numeric", month: "short" })}</span>}
        </h3>
        <span className="shrink-0 text-sm text-ink-muted">{d.stops.length ? `${duration(d.driveMin)} driving` : "Free day"}</span>
      </header>
      {d.stops.length > 0 && (
        <ol className="mt-3 space-y-1">
          <li className="text-sm text-ink-muted">Start {hhmm(d.startMin)}</li>
          {d.stops.map((s) => (
            <li key={s.placeId}>
              {s.driveMin > 0 && <p className="flex items-center gap-1.5 py-1 pl-1 text-sm text-ink-muted"><Glyph name="car" size={14} />{duration(s.driveMin)} · {km(s.driveKm)}</p>}
              <button type="button" onClick={onStop ? () => onStop(s) : undefined} disabled={!onStop}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-sky/50 px-3 py-2 text-left disabled:cursor-default">
                <span aria-hidden="true" className="grid h-8 min-w-8 shrink-0 place-items-center rounded-full bg-[var(--tm-map-stop)] px-1.5 text-sm font-bold text-[var(--tm-map-stop-text)]">{numbers.get(s.placeId)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold text-pine">{s.name}</span>
                  <span className="block text-sm text-ink-muted">
                    <span className="sr-only">Stop {numbers.get(s.placeId)}. </span>{hhmm(s.arriveMin)} · {duration(s.visitMin)} there{mustIds.has(s.placeId) ? " · must see" : ""}
                  </span>
                </span>
                {onStop && <Glyph name="down" size={16} className="shrink-0 -rotate-90 text-ink-muted" />}
              </button>
            </li>
          ))}
          {d.returnLeg && <li className="flex items-center gap-1.5 py-1 pl-1 text-sm text-ink-muted"><Glyph name="car" size={14} />{duration(d.returnLeg.driveMin)} · {km(d.returnLeg.km)} to {d.returnLeg.to} · there by {hhmm(d.endMin)}</li>}
        </ol>
      )}
      {halt && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-muted">
          <Glyph name="stay" size={15} className="mt-0.5 shrink-0" />
          <span>Night: <strong className="text-pine">{halt.town}</strong>{halt.atStop ? "" : ` · about ${km(halt.km)}, ${duration(halt.driveMin)} (estimated)`}{halt.checkStays ? " · small town, check stays" : ""}</span>
        </p>
      )}
    </article>
  );
}
