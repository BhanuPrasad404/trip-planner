import type { BriefFit, BriefVerdict } from "@/lib/trip-builder/brief";
import { duration, hhmm } from "@/lib/trip-builder";

const TONE: Record<BriefVerdict, { box: string; label: string }> = {
  fits: { box: "border-teal/40 bg-teal-light", label: "Fits" },
  fits_after_cuts: { box: "border-marigold/50 bg-marigold-light", label: "Fits with changes" },
  needs_more_days: { box: "border-clay/40 bg-clay-light", label: "Needs more days" },
  impossible: { box: "border-clay/40 bg-clay-light", label: "Doesn't fit" },
  nothing_to_plan: { box: "border-line bg-sky", label: "Nothing to plan" },
  unchecked: { box: "border-line bg-sky", label: "Not checked" },
};

/**
 * What "Describe my trip" found out about the suggestions, in plain words: does it fit, what was used to decide, what was left out and
 * why, and what could be changed. Every number here was computed from real road times; none was written by the AI.
 * The verdict is also a WORD (not only a colour) so it reads the same for everyone.
 */
export function BriefFitCard({ fit }: { fit: BriefFit }) {
  const tone = TONE[fit.verdict];
  const days = (fit.plan?.days ?? []).filter((d) => d.stops.length > 0);
  const warnings = (fit.plan?.warnings ?? []).filter((w) => w.severity !== "info").slice(0, 4);
  return (
    <section aria-labelledby="fit-heading" className={`rounded-2xl border p-4 ${tone.box}`}>
      <p className="text-xs font-bold uppercase tracking-wide text-pine/80">{tone.label}</p>
      <h3 id="fit-heading" className="mt-0.5 font-display text-lg font-semibold text-pine">{fit.headline || "We couldn't check this plan."}</h3>
      {fit.detail && <p className="mt-1 text-sm text-ink">{fit.detail}</p>}
      {fit.constraints.used.length > 0 && fit.verdict !== "unchecked" && (
        <p className="mt-2 text-sm text-ink-muted"><span className="font-semibold text-pine">Checked against:</span> {fit.constraints.used.join(" · ")}</p>
      )}

      {fit.conflicts.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-label="Things to know">
          {fit.conflicts.map((c) => (
            <li key={`${c.code}-${c.placeId ?? c.message}`} className="rounded-lg bg-white/70 px-3 py-2 text-sm font-medium text-clay-ink">{c.message}</li>
          ))}
        </ul>
      )}

      {days.length > 0 && (
        <ol className="mt-3 space-y-2" aria-label="Day by day">
          {days.map((d) => (
            <li key={d.day} className="rounded-xl bg-white/80 p-3">
              <p className="text-sm font-bold text-pine">
                Day {d.day}
                <span className="ml-2 font-medium text-ink-muted">{duration(d.driveMin)} driving · {d.intensity}</span>
              </p>
              <ul className="mt-1 space-y-0.5 text-sm">
                {d.stops.map((s) => (
                  <li key={s.placeId} className="flex gap-2">
                    <span className="w-20 shrink-0 tabular-nums text-ink-muted">{hhmm(s.arriveMin)}</span>
                    <span className="min-w-0">{s.name}{s.flags.includes("closed_at_arrival") ? <span className="ml-1 font-semibold text-clay-ink"> · may be closed</span> : null}</span>
                  </li>
                ))}
              </ul>
              {d.overnightNear && <p className="mt-1 text-xs text-ink-muted">Night near {d.overnightNear}.</p>}
            </li>
          ))}
        </ol>
      )}

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-ink" aria-label="Warnings about this plan">
          {warnings.map((w, i) => <li key={`${w.code}-${i}`} className={w.severity === "risk" ? "font-semibold text-clay-ink" : ""}>{w.message}</li>)}
        </ul>
      )}

      {fit.dropped.length > 0 && (
        <details className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-sm">
          <summary className="min-h-9 cursor-pointer py-1 font-semibold text-pine">Left out ({fit.dropped.length})</summary>
          <ul className="mt-1 space-y-1.5 pb-1">
            {fit.dropped.map((d) => <li key={d.id}><span className="font-semibold">{d.name}.</span> {d.reason}</li>)}
          </ul>
        </details>
      )}

      {fit.alternatives.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-bold text-pine">{fit.verdict === "fits" ? "Good to know" : "What you could change"}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
            {fit.alternatives.map((a, i) => <li key={`${a.kind}-${i}`}>{a.text}</li>)}
          </ul>
        </div>
      )}

      {fit.assumptions.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="min-h-9 cursor-pointer py-1 font-semibold text-pine">What this check assumes</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-muted">{fit.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
