"use client";

// The live "will it fit?" meter, pinned at the top of the questions screens. Always words + an icon, never colour alone.
import { useState } from "react";
import { Glyph } from "@/components/ui/Glyph";
import { Spinner } from "@/components/ui/Spinner";
import type { Meter } from "@/lib/intake/fit-meter";
import type { RoadsState } from "@/lib/client/use-fit-meter";

const LOOK = {
  easy: { icon: "checkCircle" as const, bar: "bg-teal", text: "text-teal-ink", label: "Fits" },
  tight: { icon: "warn" as const, bar: "bg-marigold", text: "text-[#7a4a00]", label: "Tight" },
  over: { icon: "severe" as const, bar: "bg-clay", text: "text-clay-ink", label: "Doesn't fit" },
  unknown: { icon: "info" as const, bar: "bg-line", text: "text-ink-muted", label: "Not checked yet" },
};

export function FitMeterBar({ meter, roads }: { meter: Meter; roads: RoadsState }) {
  const [open, setOpen] = useState(false);
  const look = LOOK[meter.level];
  const pct = meter.level === "unknown" ? 0 : meter.level === "over" ? 100 : Math.round(Math.min(1, meter.fullness ?? 0.5) * 100);
  return (
    <section aria-label="Will it fit?" className="sticky top-0 z-20 -mx-4 border-b border-line bg-[var(--background)]/95 px-4 py-2.5 backdrop-blur-sm sm:mx-0 sm:rounded-xl sm:border">
      <div aria-live="polite" className="flex items-start gap-2">
        {roads === "loading" ? <Spinner /> : <Glyph name={look.icon} size={18} className={`mt-0.5 ${look.text}`} />}
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-bold ${look.text}`}><span className="sr-only">{look.label}: </span>{meter.headline}</p>
          {meter.detail && <p className="text-xs text-ink-muted">{meter.detail}{meter.estimated ? " Road times are estimates right now (the routing service didn't answer)." : ""}</p>}
        </div>
        {meter.leftOut.length > 0 && (
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="tm-action min-h-11 shrink-0 text-xs font-semibold">{open ? "Hide" : "What's left out?"}</button>
        )}
      </div>
      <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-sky"><div className={`h-full ${look.bar}`} style={{ width: `${pct}%` }} /></div>
      {open && (
        <ul className="mt-2 space-y-1.5 text-xs text-ink-muted">
          {meter.leftOut.map((l) => <li key={l.name}><span className="font-semibold text-ink">{l.name}:</span> {l.reason}</li>)}
        </ul>
      )}
      <p className="mt-1 text-[11px] text-ink-muted">Checks driving and time. Opening hours, weather and night driving are checked when we plan.</p>
    </section>
  );
}
