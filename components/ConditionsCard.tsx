"use client";

import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import type { ConditionsReport } from "@/lib/client/use-conditions";
import { restAdvice, type ConditionItem, type Severity } from "@/lib/trip/conditions";

const WORD: Record<Severity, string> = { info: "Good to know", watch: "Heads-up", warning: "Warning", severe: "Serious" };
const TONE: Record<Severity, string> = { info: "bg-sky text-pine", watch: "bg-marigold-light text-[#5c3a00]", warning: "bg-clay-light text-clay-ink", severe: "bg-clay-light text-clay-ink" };
const BASIS: Record<ConditionItem["basis"], string> = { forecast: "Forecast", "confirmed-hours": "Hours confirmed on your trip", "map-hours": "Map data, not confirmed", "sun-calculation": "Sunset worked out", estimate: "Estimate", "distance-estimate": "Distance estimate" };
const FUEL = [{ v: "", t: "Not said" }, { v: "25", t: "About a quarter" }, { v: "50", t: "About half" }, { v: "75", t: "About three quarters" }, { v: "100", t: "Full" }];

type Props = {
  report: ConditionsReport | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  /** When the picture was last made (ms) and now (ms): an old answer says how old it is instead of passing as live. */
  nowMs: number;
  fuelPct: number | null;
  onFuel: (pct: number | null) => void;
  onRefresh: () => void;
  /** Open the "rearrange my trip" choices. */
  onAdjust: () => void;
  closed: boolean;
  /** Continuous driving so far (minutes) and the time of day, for the break suggestion. */
  drivingMin: number | null;
  nowMinOfDay: number | null;
};

const ago = (ms: number) => { const m = Math.max(0, Math.round(ms / 60_000)); return m < 2 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

/**
 * What could affect the plan, said plainly: each finding says what it rests on (a forecast and when it was fetched, hours confirmed by a
 * person or only from map data, a sunset calculation) and offers a way out only when we have the data for one. Below it, what could not be
 * checked, and what nobody can tell from here (traffic, road closures, fuel stations). It never says "all clear": it says what was found.
 */
export function ConditionsCard(p: Props) {
  if (p.closed) return null;
  const rest = restAdvice({ drivingMin: p.drivingMin, nowMin: p.nowMinOfDay ?? 12 * 60 });
  const items = (p.report?.items ?? []).filter((i) => i.severity !== "info");
  const info = (p.report?.items ?? []).filter((i) => i.severity === "info");
  const stale = p.report && p.nowMs - p.report.asOf > 45 * 60_000;
  if (!rest && items.length === 0 && info.length === 0 && !p.error) {
    // Nothing found: stay out of the way. A small, honest line when it was checked; the traveller can refresh.
    if (p.status !== "ready" || !p.report) return null;
    return (
      <section aria-label="Plan check" className="rounded-2xl border border-line bg-white px-4 py-3 text-sm text-ink-muted" data-testid="conditions-clear">
        <p>We checked your plan against the forecast, opening hours and daylight {ago(p.nowMs - p.report.asOf)} and found nothing to flag. {p.report.unresolved.length > 0 ? "Some things couldn't be checked: " + p.report.unresolved.join(" ") : ""}</p>
        <p className="mt-1 text-xs">{p.report.limitations.join(" ")}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="conditions-heading" className="rounded-2xl border border-line bg-white p-4 sm:p-5" data-testid="conditions-card">
      <div className="flex items-start gap-2">
        <h2 id="conditions-heading" className="min-w-0 flex-1 font-display text-lg font-semibold text-pine">What could affect your plan</h2>
        <button type="button" onClick={p.onRefresh} aria-label="Check again" className="-mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sky"><Glyph name="locate" size={18} /></button>
      </div>
      {p.report && <p className="text-xs text-ink-muted">Checked {ago(p.nowMs - p.report.asOf)}{stale ? ". This is getting old: check again before relying on it." : "."}</p>}
      {p.error && <p role="status" className="mt-2 text-xs font-semibold text-[#7a4a00]">{p.error}</p>}

      {rest && (
        <div role="status" className={`mt-3 rounded-xl px-3 py-2.5 ${rest.level === 2 ? "bg-marigold-light text-[#5c3a00]" : "bg-sky text-pine"}`} data-testid="rest-advice">
          <p className="text-sm font-semibold">{rest.title}</p>
          <p className="text-sm">{rest.body}</p>
        </div>
      )}

      <ul className="mt-3 space-y-3">
        {items.map((i) => (
          <li key={i.id} className="min-w-0 rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[i.severity]}`}>{WORD[i.severity]}</span>
              <h3 className="min-w-0 break-words text-base font-semibold text-pine">{i.title}</h3>
            </div>
            <p className="mt-1 break-words text-sm text-ink-muted">{i.detail}</p>
            {i.recommendation && <p className="mt-1 break-words text-sm text-pine"><span className="font-semibold">What you could do:</span> {i.recommendation}</p>}
            <p className="mt-1 break-words text-xs text-ink-muted">{BASIS[i.basis]}{i.source ? `: ${i.source}` : ""}</p>
          </li>
        ))}
      </ul>
      {info.length > 0 && (
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer select-none py-2 text-sm font-semibold text-pine">Also good to know ({info.length})</summary>
          <ul className="mt-1 space-y-2">{info.map((i) => <li key={i.id} className="break-words text-sm text-ink-muted"><span className="font-semibold text-pine">{i.title}.</span> {i.detail}{i.recommendation ? ` ${i.recommendation}` : ""}</li>)}</ul>
        </details>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {items.length > 0 && <Button size="sm" onClick={p.onAdjust} className="min-h-11">Rearrange my trip</Button>}
        <label className="flex min-h-11 items-center gap-2 text-sm text-pine">
          <span>Fuel in the tank</span>
          <select className="min-h-11 rounded-xl border border-line bg-white px-2 text-sm" value={p.fuelPct === null ? "" : String(p.fuelPct)} onChange={(e) => p.onFuel(e.target.value === "" ? null : Number(e.target.value))} aria-label="How full is your tank? Optional">
            {FUEL.map((f) => <option key={f.v} value={f.v}>{f.t}</option>)}
          </select>
        </label>
      </div>

      {p.report && p.report.unresolved.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-sm font-semibold text-pine">What we couldn&apos;t check</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted">{p.report.unresolved.map((u) => <li key={u} className="break-words">{u}</li>)}</ul>
        </div>
      )}
      {p.report && <p className="mt-3 break-words border-t border-line pt-3 text-xs text-ink-muted">{p.report.limitations.join(" ")}</p>}
    </section>
  );
}
