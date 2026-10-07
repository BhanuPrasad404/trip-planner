"use client";

import { useState } from "react";
import type { Advice } from "@/lib/intel/types";
import { googleMapsDirections } from "@/lib/maps-links";
import { Button } from "../ui/Button";
import { Glyph } from "@/components/ui/Glyph";

type Props = {
  advice: Advice | null;
  busy: boolean;
  onAccept: (a: Advice) => void;
  onKeep: (a: Advice) => void;
  /** When there is no advice: what is next, with real numbers if we have them. */
  fallback: { title: string; detail: string; navigateTo: { lat: number; lng: number } | null; action: "start-drive" | "plan" | null; href?: string };
  onStartDrive: () => void;
};

const ACCEPT = (a: Advice) =>
  a.action?.type === "replan" ? "Accept: re-plan from now" : a.action?.type === "move_next_day" ? "Accept: move to tomorrow" : a.action?.type === "skip" ? "Accept: skip it" : a.action?.type === "insert_stop" ? "Go there" : null;

/** The single most useful thing to do right now, and why. Everything else on the page supports this card. */
export function NextBestAction({ advice, busy, onAccept, onKeep, fallback, onStartDrive }: Props) {
  const [why, setWhy] = useState(false);
  const accept = advice ? ACCEPT(advice) : null;
  const first = advice?.options?.[0];

  return (
    <section aria-labelledby="nba-heading" className="rounded-3xl bg-pine p-5 text-white shadow-sm sm:p-6">
      <p id="nba-heading" className="font-mono text-xs font-semibold uppercase tracking-widest text-marigold">Next best action</p>
      {advice ? (
        <>
          <h2 className="mt-2 break-words font-display text-2xl font-semibold leading-tight sm:text-3xl">{advice.title}</h2>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-white/90">{advice.detail}</p>
          {first && (
            <p className="mt-2 text-sm text-white/80">
              <strong className="text-white">{first.name}</strong> · {first.etaMin < 1 ? "just ahead" : `${first.etaMin} min ahead`} · {first.detourMin > 0 ? `${first.detourMin} min detour` : "on your road"}{" "}
              · <a href={googleMapsDirections(first)} target="_blank" rel="noopener noreferrer" className="font-semibold text-marigold underline underline-offset-2">Navigate in Google Maps<span className="sr-only"> (opens in a new tab)</span></a>
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {accept && <Button onClick={() => onAccept(advice)} disabled={busy}>{busy ? "Working…" : accept}</Button>}
            <Button variant="secondary" onClick={() => onKeep(advice)} disabled={busy}>Keep my plan</Button>
            {advice.why && advice.why.length > 0 && <button type="button" onClick={() => setWhy((v) => !v)} aria-expanded={why} className="min-h-11 px-2 text-sm font-semibold text-white underline underline-offset-2">{why ? "Hide why" : "Why?"}</button>}
          </div>
          {why && advice.why && <ul className="mt-3 list-disc space-y-1 rounded-xl bg-white/10 py-3 pl-8 pr-4 text-sm text-white/95">{advice.why.map((w) => <li key={w}>{w}</li>)}</ul>}
        </>
      ) : (
        <>
          <h2 className="mt-2 break-words font-display text-2xl font-semibold leading-tight sm:text-3xl">{fallback.title}</h2>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-white/90">{fallback.detail}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {fallback.navigateTo && (
              <a href={googleMapsDirections(fallback.navigateTo)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-marigold px-5 font-bold text-pine hover:bg-[#f0b254]">
                Navigate in Google Maps<span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
            {fallback.action === "start-drive" && <Button variant="secondary" onClick={onStartDrive}><span className="inline-flex items-center gap-1.5"><Glyph name="play" size={16} />Start drive</span></Button>}
            {fallback.action === "plan" && fallback.href && <a href={fallback.href} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-5 font-bold text-pine">Plan this day</a>}
          </div>
        </>
      )}
    </section>
  );
}
