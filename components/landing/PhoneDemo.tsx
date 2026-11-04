"use client";

// The real Live header (the same component the app uses) inside a phone, with a switch between three moments of a trip, so a visitor sees
// what the app does at each one. It is an EXAMPLE: the route is the landing page's real sample route, and there are no invented times,
// distances or arrival estimates on it.
import { useState } from "react";
import { LiveHeader } from "@/components/live/LiveHeader";
import type { LivePhase } from "@/lib/trip/live-phase";

const MOMENTS = [
  { id: "not-started" as const, label: "Before you leave", note: "One clear button to start, and it tells you what it does first." },
  { id: "travelling" as const, label: "On the road", note: "Where you are headed, what is next, and quick ways to pause or add a stop." },
  { id: "at-stop" as const, label: "At a stop", note: "Finish a stop when you're ready: nothing is marked from your location alone." },
];
const noop = () => undefined;

export function PhoneDemo({ compact = false, onDark = false }: { compact?: boolean; /** On the deep-pine hero: light chips and text. */ onDark?: boolean }) {
  const [phase, setPhase] = useState<Extract<LivePhase, "not-started" | "travelling" | "at-stop">>("travelling");
  const m = MOMENTS.find((x) => x.id === phase)!;
  return (
    <div className="w-full">
      <div className="mx-auto w-full max-w-[19.5rem]">
        <div className="rounded-[2.6rem] border-[7px] border-ink bg-ink p-0 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.55)]">
          <div className="relative overflow-hidden rounded-[2.1rem] bg-background">
            <div aria-hidden="true" className="mx-auto mt-2 h-1.5 w-16 rounded-full bg-ink/15" />
            <div className="space-y-3 p-3 pt-2">
              <LiveHeader
                key={phase} phase={phase} tripName="Hyderabad → Warangal" route={null}
                next={{ name: phase === "at-stop" ? "Thousand Pillar Temple" : "Warangal Fort", plannedTime: null, distanceText: null, minutes: null, etaClock: null, delay: null, after: phase === "at-stop" ? "Ramappa Temple" : "Thousand Pillar Temple" }}
                timing={{ kind: "unknown", minutes: 0, text: "" }} stops={{ done: phase === "not-started" ? 0 : phase === "travelling" ? 1 : 2, skipped: 0, total: 4 }}
                since={null} atStop={phase === "at-stop" ? { name: "Thousand Pillar Temple", arrivedClock: null, canFinish: true } : null} hasLocation closedWords={null} busy={false}
                onStart={noop} onUnplanned={noop} onPause={noop} onRest={noop} onResume={noop} onFinishStop={noop}
              />
              {!compact && <p className="px-1 pb-1 text-center text-[11px] text-ink-muted">Example screen · the real Live tab</p>}
            </div>
          </div>
        </div>
      </div>
      <div role="group" aria-label="Moment of the trip" className="mt-5 flex flex-wrap justify-center gap-2">
        {MOMENTS.map((x) => (
          <button key={x.id} type="button" aria-pressed={phase === x.id} onClick={() => setPhase(x.id)} className={`min-h-11 rounded-full px-4 text-sm font-semibold transition active:scale-95 ${phase === x.id ? (onDark ? "bg-marigold text-ink" : "bg-pine text-white") : onDark ? "bg-white/10 text-white ring-1 ring-white/25 hover:bg-white/20" : "bg-white text-pine ring-1 ring-line hover:ring-teal"}`}>{x.label}</button>
        ))}
      </div>
      <p aria-live="polite" className={`mx-auto mt-3 max-w-xs text-center text-sm ${onDark ? "text-white/80" : "text-ink-muted"}`}>{m.note}</p>
    </div>
  );
}
