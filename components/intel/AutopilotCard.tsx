"use client";

import { useState } from "react";
import type { PoiPhoto } from "@/lib/intel/poi-media";
import type { Advice } from "@/lib/intel/types";
import { Button } from "../ui/Button";
import { PlaceRow } from "./PlaceRow";

type Props = {
  advice: Advice;
  photos: Record<string, PoiPhoto>;
  busy: boolean;
  onAccept: (a: Advice, optionKey?: string) => void;
  onKeep: (a: Advice) => void;
};

const TONE = { now: "border-clay/40 bg-clay-light/70", soon: "border-marigold/50 bg-marigold-light/60", later: "border-line bg-white" } as const;
const WORD = { now: "Now", soon: "Soon", later: "When you can" } as const;

const ACCEPT_LABEL = (a: Advice) =>
  a.action?.type === "replan" ? "Accept: re-plan from now" : a.action?.type === "move_next_day" ? "Accept: move to tomorrow" : a.action?.type === "skip" ? "Accept: skip it" : a.action?.type === "insert_stop" ? "Go there" : null;

/** One suggestion from Trip Autopilot. It explains itself, and nothing changes until the traveller says so. */
export function AutopilotCard({ advice: a, photos, busy, onAccept, onKeep }: Props) {
  const [why, setWhy] = useState(false);
  const [alts, setAlts] = useState(false);
  const accept = ACCEPT_LABEL(a);
  const options = a.options ?? [];
  const shown = alts ? options : options.slice(0, 1);

  return (
    <li className={`rounded-2xl border p-4 ${TONE[a.urgency]}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="break-words text-base font-semibold leading-snug text-pine">{a.title}</h3>
        <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold text-ink-muted">{WORD[a.urgency]}</span>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-ink">{a.detail}</p>

      {shown.length > 0 && (
        <ul className="mt-1 divide-y divide-line/70">
          {shown.map((o) => (
            <PlaceRow key={o.key} kind={o.kind} name={o.name} lat={o.lat} lng={o.lng} etaMin={o.etaMin} aheadKm={o.aheadKm} detourMin={o.detourMin} open={o.open} hours={o.hours} fetchedAt={o.fetchedAt} photo={photos[o.key]}>
              {a.action?.type === "insert_stop" && alts && (
                <button type="button" disabled={busy} onClick={() => onAccept(a, o.key)} className="min-h-9 py-1.5 font-semibold text-pine underline underline-offset-2 disabled:opacity-60">Go here instead</button>
              )}
            </PlaceRow>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {accept && <Button size="sm" onClick={() => onAccept(a)} disabled={busy}>{busy ? "Working…" : accept}</Button>}
        <Button size="sm" variant="secondary" onClick={() => onKeep(a)} disabled={busy}>Keep my plan</Button>
        {options.length > 1 && <button type="button" onClick={() => setAlts((v) => !v)} aria-expanded={alts} className="min-h-10 px-2 text-sm font-semibold text-pine underline underline-offset-2">{alts ? "Hide alternatives" : `Show ${options.length - 1} alternative${options.length > 2 ? "s" : ""}`}</button>}
        {a.why && a.why.length > 0 && <button type="button" onClick={() => setWhy((v) => !v)} aria-expanded={why} className="min-h-10 px-2 text-sm font-semibold text-ink-muted underline underline-offset-2">{why ? "Hide why" : "Why?"}</button>}
      </div>

      {why && a.why && (
        <ul className="mt-2 list-disc space-y-1 rounded-xl bg-white/70 py-2 pl-7 pr-3 text-sm text-ink">
          {a.why.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </li>
  );
}
