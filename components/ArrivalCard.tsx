"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";

export type ArrivalNext = { name: string; km: number | null; minutes: number | null; mapsHref: string | null; /** How to read km ("about 12 km", "(estimated)"); preferred over km. */ kmText?: string | null };

type Props = {
  prompt: { name: string; distanceM: number; accuracyM: number; /** A large place reached as an area. */ area?: boolean; /** The end of the trip: "Finish drive", not "Mark as done". */ destination?: boolean } | null;
  unsure: { name: string; distanceM: number; accuracyM: number | null } | null;
  done: { name: string; queued: boolean; earlier: { id: string; name: string }[] } | null;
  /** "3 of 5 stops done" */
  progress: { done: number; total: number } | null;
  next: ArrivalNext | null;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  onConfirmUnsure: () => void;
  onDismissUnsure: () => void;
  onUndo: () => void;
  onSkipEarlier: () => void;
  onKeepEarlier: () => void;
  onClose: () => void;
  /** Start in-app navigation to the next stop from where the traveller is now. null when it cannot be offered. */
  onNavigate: (() => void) | null;
};

const CONFIRMED_VISIBLE_MS = 25_000;

/**
 * What the traveller sees when they reach a stop. Three separate situations, each honest about what we know:
 *   • we are sure enough to ASK ("You have arrived at X" with "Mark as done"),
 *   • we are close but the GPS is too vague to be sure (we say so, and they can mark it by hand),
 *   • they said yes: it is saved (or kept on the phone until there is signal), and the next stop is one tap away.
 * Nothing is marked until the traveller says yes. Everything here can be dismissed.
 */
export function ArrivalCard(p: Props) {
  // The "marked visited" card tidies itself away after a while, unless there is still a choice to make (skipped stops).
  const choosing = !!p.done && p.done.earlier.length > 0;
  useEffect(() => {
    if (!p.done || choosing) return;
    const t = window.setTimeout(p.onClose, CONFIRMED_VISIBLE_MS);
    return () => window.clearTimeout(t);
  }, [p.done, choosing, p.onClose]);

  if (!p.prompt && !p.unsure && !p.done) return null;
  const shell = "tm-sheet-in pointer-events-auto mx-auto w-full max-w-md rounded-2xl border bg-white p-4 shadow-[0_12px_32px_rgba(11,61,58,0.22)]";

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 space-y-2" data-testid="arrival-card">
      {p.prompt && (
        <section role="alertdialog" aria-modal="false" aria-labelledby="arrival-title" aria-describedby="arrival-sub" className={`${shell} border-teal/40`}>
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-teal-light text-teal-ink"><Glyph name="pin" size={22} /></span>
            <div className="min-w-0 flex-1">
              <h2 id="arrival-title" className="text-lg font-semibold leading-snug text-pine">{p.prompt.area ? <>You&apos;ve reached the {p.prompt.name} area</> : <>You have arrived at {p.prompt.name}</>}</h2>
              <p id="arrival-sub" className="mt-0.5 text-sm text-ink-muted">{p.prompt.destination ? "This is the end of your route." : "Mark it as done when you're there, or keep going."}</p>
              <p className="mt-1 text-xs text-ink-muted">About {p.prompt.distanceM} m from its pin · GPS accurate to ±{p.prompt.accuracyM} m</p>
            </div>
            <button type="button" onClick={p.onDismiss} aria-label={`Dismiss: not at ${p.prompt.name} yet`} className="-mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sky"><Glyph name="close" size={18} /></button>
          </div>
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <Button onClick={p.onConfirm} loading={p.busy} loadingLabel="Saving…" className="min-h-12 text-base"><Glyph name={p.prompt.destination ? "flag" : "check"} size={18} />{p.prompt.destination ? "Finish drive" : "Mark as done"}</Button>
            <Button variant="secondary" onClick={p.onDismiss} disabled={p.busy}>Not yet</Button>
          </div>
        </section>
      )}

      {!p.prompt && p.unsure && (
        <section role="status" aria-live="polite" className={`${shell} border-line`}>
          <p className="text-sm font-semibold text-pine">You may be near {p.unsure.name}.</p>
          <p className="mt-0.5 text-xs text-ink-muted">Your GPS isn&apos;t precise enough to be sure{p.unsure.accuracyM ? ` (±${p.unsure.accuracyM} m)` : ""}, so we won&apos;t mark it for you.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={p.onConfirmUnsure} loading={p.busy}>I&apos;m here: mark as done</Button>
            <Button size="sm" variant="secondary" onClick={p.onDismissUnsure}>Dismiss</Button>
          </div>
        </section>
      )}

      {p.done && (
        <section role="status" aria-live="polite" className={`${shell} border-teal/40`}>
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="tm-check-pop grid h-11 w-11 shrink-0 place-items-center rounded-full bg-teal text-white"><Glyph name="check" size={22} strokeWidth={2.8} /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold leading-snug text-pine">{p.done.name} marked as done.</h2>
              {p.done.queued && <p className="mt-0.5 text-xs font-semibold text-[#7a4a00]">Saved on this phone. It will be sent when you&apos;re back online.</p>}
              {p.progress && p.progress.total > 0 && <p className="mt-0.5 text-sm text-ink-muted">{p.progress.done} of {p.progress.total} {p.progress.total === 1 ? "stop" : "stops"} done today.</p>}
            </div>
            <button type="button" onClick={p.onClose} aria-label="Close" className="-mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sky"><Glyph name="close" size={18} /></button>
          </div>

          {choosing && (
            <div className="mt-3 rounded-xl bg-marigold-light/60 px-3 py-2.5">
              <p className="text-sm font-semibold text-pine">You skipped {p.done.earlier.length} earlier {p.done.earlier.length === 1 ? "stop" : "stops"}: {p.done.earlier.map((e) => e.name).join(", ")}.</p>
              <p className="text-xs text-ink-muted">Mark {p.done.earlier.length === 1 ? "it" : "them"} as skipped? Nothing changes unless you choose.</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={p.onSkipEarlier}>Mark skipped</Button>
                <Button size="sm" variant="secondary" onClick={p.onKeepEarlier}>Keep {p.done.earlier.length === 1 ? "it" : "them"} planned</Button>
              </div>
            </div>
          )}

          {!choosing && p.next && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-sm text-ink-muted"><span className="font-semibold text-pine">Next: {p.next.name}</span>{p.next.kmText ? ` · ${p.next.kmText}` : p.next.km !== null ? ` · ${p.next.km < 10 ? p.next.km.toFixed(1) : Math.round(p.next.km)} km` : ""}{p.next.minutes !== null ? ` · about ${p.next.minutes} min` : ""}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {p.onNavigate && <Button size="sm" onClick={p.onNavigate}><Glyph name="navigate" size={16} />Navigate from here</Button>}
                {p.next.mapsHref && <a href={p.next.mapsHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-3.5 text-sm font-bold text-pine hover:bg-teal-light sm:min-h-10"><Glyph name="external" size={15} />Open in Google Maps<span className="sr-only"> (opens in a new tab)</span></a>}
                <Button size="sm" variant="ghost" onClick={p.onUndo}><Glyph name="uturn" size={15} />Undo</Button>
              </div>
            </div>
          )}
          {!choosing && !p.next && (
            <div className="mt-2"><Button size="sm" variant="ghost" onClick={p.onUndo}><Glyph name="uturn" size={15} />Undo</Button></div>
          )}
        </section>
      )}
    </div>
  );
}
