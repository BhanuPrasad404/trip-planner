"use client";

// The top of Live: one deep-pine card that says where the journey is RIGHT NOW (not started, on the road, almost there, at a stop, paused,
// resting, finished), what is next, and offers the one thing to do about it as the big button. Everything on it comes from real state:
// the journey's events, the plan, and a live position when there is one. Nothing is shown that isn't known: no distance or arrival time
// without a reliable route, and with no location it says the trip is being followed by hand.
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { PHASE_PILL, type DepartureTiming, type LivePhase } from "@/lib/trip/live-phase";

export type NextInfo = {
  name: string;
  plannedTime: string | null;
  /** Only when a real route measured it. */
  distanceText: string | null;
  minutes: number | null;
  etaClock: string | null;
  /** "12 min late" / "On time" (from the engine's own estimate), or null. */
  delay: { text: string; tone: "late" | "ok" | "neutral" } | null;
  after: string | null;
};

type Props = {
  phase: LivePhase;
  tripName: string;
  route: string | null;
  next: NextInfo | null;
  timing: DepartureTiming;
  stops: { done: number; skipped: number; total: number };
  /** Since when, in words ("since 9:44 AM"), for on the road / paused / resting. */
  since: string | null;
  atStop: { name: string; arrivedClock: string | null; canFinish: boolean } | null;
  /** A precise live position is available. */
  hasLocation: boolean;
  closedWords: string | null;
  busy: boolean;
  onStart: () => void;
  onUnplanned: () => void;
  onPause: () => void;
  onRest: () => void;
  onResume: () => void;
  onFinishStop: () => void;
  /** Starts the live drive (location + route), when it isn't running. */
  onStartDrive?: (() => void) | null;
};

const HEAD: Record<LivePhase, (p: Props) => string> = {
  "not-started": () => "Ready when you are",
  travelling: (p) => (p.next ? `On the road to ${p.next.name}` : "On the road"),
  approaching: (p) => (p.next ? `Almost at ${p.next.name}` : "Almost there"),
  "at-stop": (p) => (p.atStop ? `You're at ${p.atStop.name}` : "You're at a stop"),
  paused: () => "Paused for now",
  resting: () => "Resting",
  finished: () => "Trip finished",
};

export function LiveHeader(p: Props) {
  const { phase, next } = p;
  const done = p.stops.done + p.stops.skipped;
  const pct = p.stops.total > 0 ? Math.round((done / p.stops.total) * 100) : 0;
  const ghost = "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20 active:scale-[0.97] disabled:opacity-60";
  const live = phase === "travelling" || phase === "approaching";

  return (
    <section aria-labelledby="live-head" className="relative overflow-hidden rounded-[2rem] bg-pine p-5 text-white shadow-float sm:p-7" data-testid="live-header" data-phase={phase}>
      <svg aria-hidden="true" viewBox="0 0 400 120" preserveAspectRatio="xMidYMax slice" className="pointer-events-none absolute inset-x-0 bottom-0 h-28 w-full opacity-60">
        <path d="M0 120V84c46-30 82-20 120 0 40-28 92-36 130-8 40-18 92-12 150 14v30z" className="fill-teal" opacity="0.5" />
      </svg>
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-wide" role="status">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-marigold motion-reduce:animate-none" : phase === "finished" ? "bg-white/60" : "bg-marigold"}`} />
            {PHASE_PILL[phase]}
          </span>
          {p.since && (phase === "travelling" || phase === "approaching" || phase === "paused" || phase === "resting") && <span className="text-xs text-white/75">{p.since}</span>}
        </div>

        <h1 id="live-head" className="mt-2 break-words font-display text-3xl font-semibold leading-tight sm:text-4xl">{HEAD[phase](p)}</h1>
        <p className="mt-1 break-words text-sm text-white/80">{p.tripName}{p.route && <> · {p.route}</>}</p>

        {/* What matters in this moment */}
        {phase === "not-started" && (
          <div className="mt-4 space-y-2">
            {next && <p className="text-base text-white/95">First stop: <strong>{next.name}</strong>{next.plannedTime && <span className="text-white/75"> · planned {next.plannedTime}</span>}</p>}
            {p.timing.kind !== "unknown" && <p className="text-sm text-white/80">{p.timing.text}</p>}
          </div>
        )}
        {(phase === "travelling" || phase === "approaching") && next && (
          <div className="mt-4 flex flex-wrap gap-2" aria-label={`Next stop ${next.name}`}>
            {p.hasLocation && next.distanceText && <span className="rounded-2xl bg-white/12 px-3 py-2 text-sm"><span className="block text-[11px] uppercase tracking-wide text-white/70">Left</span><strong className="text-base">{next.distanceText}</strong>{next.minutes !== null && <span className="text-white/80"> · {next.minutes} min</span>}</span>}
            {next.etaClock && <span className="rounded-2xl bg-white/12 px-3 py-2 text-sm"><span className="block text-[11px] uppercase tracking-wide text-white/70">Arrive about</span><strong className="text-base">{next.etaClock}</strong></span>}
            {next.delay && <span className={`rounded-2xl px-3 py-2 text-sm font-semibold ${next.delay.tone === "late" ? "bg-clay-light text-clay-ink" : next.delay.tone === "ok" ? "bg-teal-light text-teal-ink" : "bg-white/12"}`}>{next.delay.text}</span>}
            {next.plannedTime && <span className="rounded-2xl bg-white/12 px-3 py-2 text-sm"><span className="block text-[11px] uppercase tracking-wide text-white/70">Planned</span><strong className="text-base">{next.plannedTime}</strong></span>}
          </div>
        )}
        {phase === "approaching" && <p className="mt-3 text-sm text-white/85">We&apos;ll ask you to confirm when you&apos;ve reached it. Nothing is marked from your location alone.</p>}
        {phase === "at-stop" && p.atStop && (
          <p className="mt-3 text-sm text-white/85">{p.atStop.arrivedClock ? `You arrived at ${p.atStop.arrivedClock}. ` : ""}Take your time. Tap <strong>Finished this stop</strong> when you&apos;re done here (it marks the stop visited). Still exploring? Just carry on: nothing changes until you say so.</p>
        )}
        {phase === "paused" && <p className="mt-3 text-sm text-white/85">Your plan hasn&apos;t changed. Tap <strong>Back on the road</strong> when you set off again.</p>}
        {phase === "resting" && <p className="mt-3 text-sm text-white/85">Rest well. Your plan stays as it is. Tap <strong>Back on the road</strong> when you continue{next ? <>, next up: <strong>{next.name}</strong></> : null}.</p>}
        {phase === "finished" && <p className="mt-3 text-sm text-white/85">{p.closedWords ?? "This trip is finished."} Its stops, activity and memories are kept.</p>}

        {phase !== "finished" && p.stops.total > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-white/75"><span>{done === 0 ? "No stops done yet" : `${done} of ${p.stops.total} stops done`}</span>{next?.after && <span className="truncate pl-3">Then: {next.after}</span>}</div>
            <div role="progressbar" aria-label="Stops done today" aria-valuemin={0} aria-valuemax={p.stops.total} aria-valuenow={done} className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/15"><span className="block h-full rounded-full bg-marigold transition-all duration-500" style={{ width: `${Math.max(pct, done > 0 ? 6 : 0)}%` }} /></div>
          </div>
        )}

        {/* The one main thing to do, then the rest */}
        {phase !== "finished" && (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {phase === "not-started" && <Button className="min-h-14 w-full text-lg sm:w-auto sm:px-8" onClick={p.onStart} disabled={p.busy}><Glyph name="navigate" size={20} />Start my trip</Button>}
            {phase === "at-stop" && p.atStop?.canFinish && <Button className="min-h-14 w-full text-lg sm:w-auto sm:px-8" onClick={p.onFinishStop} disabled={p.busy}><Glyph name="checkCircle" size={20} />Finished this stop</Button>}
            {(phase === "paused" || phase === "resting") && <Button className="min-h-14 w-full text-lg sm:w-auto sm:px-8" onClick={p.onResume} disabled={p.busy}><Glyph name="navigate" size={20} />Back on the road</Button>}
            {(phase === "travelling" || phase === "approaching") && !p.hasLocation && p.onStartDrive && <Button className="min-h-14 w-full text-lg sm:w-auto sm:px-8" onClick={p.onStartDrive} disabled={p.busy}><Glyph name="locate" size={20} />Turn on live tracking</Button>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={ghost} onClick={p.onUnplanned} disabled={p.busy}><Glyph name="plus" size={16} />Add an unplanned stop</button>
              {(phase === "travelling" || phase === "approaching") && <button type="button" className={ghost} onClick={p.onPause} disabled={p.busy}>Short pause</button>}
              {(phase === "travelling" || phase === "approaching" || phase === "paused") && <button type="button" className={ghost} onClick={p.onRest} disabled={p.busy}><Glyph name="moon" size={16} />Stop for the night</button>}
            </div>
          </div>
        )}

        {phase !== "finished" && !p.hasLocation && (
          <p className="mt-3 flex items-start gap-2 text-xs text-white/75"><Glyph name="info" size={14} className="mt-0.5 shrink-0" />{phase === "not-started" ? "Location isn't needed to start." : "Location is off, so we're following your trip by what you tell us. Distances and arrival prompts need location."}</p>
        )}
      </div>
    </section>
  );
}
