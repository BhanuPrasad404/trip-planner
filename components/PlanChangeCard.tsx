"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { ProposalDetails } from "@/components/ProposalDetails";
import type { ProposalDTO, ProposeAnswer } from "@/lib/client/use-plan-change";
import type { Staleness } from "@/lib/trip/replan-proposal";

const dur = (min: number) => { const m = Math.max(0, Math.round(min)); const h = Math.floor(m / 60); return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`; };

/** In the traveller's words: what is wrong with the plan, judged from what has really happened. */
export function staleHeadline(s: Staleness): { title: string; body: string } {
  switch (s.kind) {
    case "late-departure": return { title: "You haven't set off yet", body: `You were due to leave about ${dur(s.minutesLate)} ago for ${s.firstStop}. The times in your plan assumed you'd be on the road by now. Nothing has been changed.` };
    case "missed-day": return { title: s.missedDays === 1 ? "A planned day went by" : `${s.missedDays} planned days went by`, body: `There are stops still to do from Day ${s.firstDay}. They are not marked done and none have been removed. Here is what you can do about them.` };
    case "running-behind": return { title: "You're running behind", body: `You're about ${dur(s.minutesBehind)} behind at ${s.stop}. Nothing has been changed; here are the choices.` };
  }
}

type Props = {
  staleness: Staleness | null;
  /** Show the options even when nothing looks wrong (the traveller asked). */
  forceOpen: boolean;
  closed: boolean;
  hasOpenStops: boolean;
  status: "idle" | "asking" | "ready" | "error";
  answer: ProposeAnswer | null;
  error: string | null;
  busy: number | null;
  nightDriving: boolean;
  applied: { rev: number; label: string; changed: number } | null;
  quiet: boolean;
  onAsk: (o?: { nightDriving?: boolean; keep?: string[] }) => void;
  onApprove: (rev: number) => void;
  onDecline: (rev: number) => void;
  onUndo: () => void;
  onClose: () => void;
  onCloseApplied: () => void;
  /** "Keep my plan as it is": not asked again about this for a while. */
  onKeepPlan: () => void;
  /** The trip's owner may approve; everyone else may only suggest a change to the owner. */
  isOwner?: boolean;
  /** Suggestions this person has already sent to the owner (their numbers), and how to send one. */
  suggested?: number[];
  onSuggest?: (rev: number) => void;
  /** Start with this suggestion's details showing (its number, or its way of dealing with it when it has none). */
  initiallyOpen?: number | string;
};

/**
 * When the plan no longer matches what is happening: say so once, calmly, and offer real options. Every option explains what changes and
 * why, what it leaves alone, and what we are unsure of. Nothing is applied until the traveller taps "Use this plan"; "Keep my plan as it is"
 * is always available, and is remembered so the question is not repeated.
 */
export function PlanChangeCard(p: Props) {
  const [open, setOpen] = useState<number | string | null>(p.initiallyOpen ?? null);
  const [keep, setKeep] = useState<string[]>([]);

  if (p.applied) {
    return (
      <section role="status" className="rounded-2xl border border-teal/40 bg-teal-light px-4 py-4 text-teal-ink" data-testid="plan-change-applied">
        <p className="font-semibold">Your plan is updated: {p.applied.label}.</p>
        <p className="mt-0.5 text-sm">{p.applied.changed === 0 ? "No stop needed to move." : `${p.applied.changed} stop${p.applied.changed === 1 ? "" : "s"} changed. Your original plan is still saved.`}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={p.onUndo} loading={p.busy === p.applied.rev} loadingLabel="Undoing…"><Glyph name="uturn" size={15} />Undo this change</Button>
          <Button size="sm" variant="ghost" onClick={p.onCloseApplied}>Done</Button>
        </div>
        {p.error && <p role="alert" className="mt-2 text-sm font-medium text-clay-ink">{p.error}</p>}
      </section>
    );
  }
  if (p.closed || !p.hasOpenStops) return null;

  const showing = p.status !== "idle" || p.forceOpen;
  if (!showing) {
    if (!p.staleness || p.quiet) return null;
    const h = staleHeadline(p.staleness);
    return (
      <section aria-labelledby="plan-change-heading" className="rounded-2xl border border-marigold/40 bg-marigold-light px-4 py-4 text-[#5c3a00]" data-testid="plan-change-nudge">
        <h2 id="plan-change-heading" className="font-semibold">{h.title}</h2>
        <p className="mt-1 text-sm">{h.body}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => p.onAsk()} className="min-h-11">See my options</Button>
          <Button size="sm" variant="secondary" onClick={p.onKeepPlan} className="min-h-11">Keep my plan as it is</Button>
        </div>
      </section>
    );
  }

  const head = p.staleness ? staleHeadline(p.staleness) : { title: "Change my plan", body: "Here are the ways to adjust the rest of your trip. Nothing changes until you choose one." };
  return (
    <section aria-labelledby="plan-change-heading" className="rounded-2xl border border-line bg-white p-4 sm:p-5" data-testid="plan-change-options">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 id="plan-change-heading" className="font-display text-lg font-semibold text-pine">{head.title}</h2>
          <p className="mt-0.5 text-sm text-ink-muted">{head.body}</p>
        </div>
        <button type="button" onClick={() => { setOpen(null); p.onClose(); }} aria-label="Close" className="-mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sky"><Glyph name="close" size={18} /></button>
      </div>

      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-pine">
        <input type="checkbox" className="h-5 w-5 accent-[var(--teal)]" checked={p.nightDriving} onChange={(e) => p.onAsk({ nightDriving: e.target.checked })} disabled={p.status === "asking"} />
        <span>I&apos;m happy to drive at night if it helps</span>
      </label>

      {p.status === "asking" && <p role="status" className="mt-3 text-sm text-ink-muted">Working out your options…</p>}
      {p.status === "idle" && p.forceOpen && <div className="mt-3"><Button size="sm" onClick={() => p.onAsk()} className="min-h-11">Show my options</Button></div>}
      {p.error && <p role="alert" className="mt-3 rounded-xl bg-clay-light px-3 py-2 text-sm font-medium text-clay-ink">{p.error}</p>}

      {p.answer && (
        <ul className="mt-3 space-y-3">
          {p.answer.proposals.map((o: ProposalDTO) => {
            const id = o.rev ?? o.strategy;
            const expanded = open === id;
            return (
              <li key={`${o.strategy}-${o.rev ?? "x"}`} className={`rounded-xl border p-3 ${o.feasible ? "border-line" : "border-line bg-sky"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="min-w-0 break-words text-base font-semibold text-pine">{o.label}</h3>
                  {!o.feasible && <span className="rounded-full bg-clay-light px-2 py-0.5 text-xs font-semibold text-clay-ink">Doesn&apos;t work</span>}
                  {o.night.arrivals > 0 && <span className="rounded-full bg-sky px-2 py-0.5 text-xs font-semibold text-pine">Night arrival</span>}
                  {o.bookingConflicts.length > 0 && <span className="rounded-full bg-marigold-light px-2 py-0.5 text-xs font-semibold text-[#5c3a00]">Bookings affected</span>}
                </div>
                <p className="mt-1 break-words text-sm text-ink-muted">{o.summary}</p>
                <button type="button" onClick={() => setOpen(expanded ? null : id)} aria-expanded={expanded} className="mt-1 min-h-11 text-sm font-semibold text-teal-ink underline underline-offset-2">{expanded ? "Hide the details" : "See what changes"}</button>

                {expanded && <ProposalDetails o={o} onKeep={(id) => { const next = keep.includes(id) ? keep : [...keep, id]; setKeep(next); p.onAsk({ keep: next }); }} />}

                <div className="mt-2 flex flex-wrap gap-2">
                  {o.canApprove && o.rev !== null && <Button size="sm" onClick={() => p.onApprove(o.rev!)} loading={p.busy === o.rev} loadingLabel="Applying…" disabled={p.busy !== null} className="min-h-11">Use this plan</Button>}
                  {o.canApprove && o.rev !== null && <Button size="sm" variant="secondary" onClick={() => p.onDecline(o.rev!)} disabled={p.busy !== null} className="min-h-11">Not this one</Button>}
                  {!o.canApprove && o.canSuggest && o.rev !== null && p.onSuggest && (
                    (p.suggested ?? []).includes(o.rev)
                      ? <p role="status" className="min-h-11 py-2.5 text-sm font-semibold text-teal-ink">Suggested to the trip owner</p>
                      : <Button size="sm" onClick={() => p.onSuggest!(o.rev!)} disabled={p.busy !== null} className="min-h-11">Suggest this to the trip owner</Button>
                  )}
                </div>
                {!o.canApprove && o.canSuggest && <p className="mt-1 text-xs text-ink-muted">Only the trip owner can approve changes to the shared plan. You can suggest this to them.</p>}
              </li>
            );
          })}
          {p.answer.proposals.length === 0 && <li className="text-sm text-ink-muted">Every option has been set aside. Your plan hasn&apos;t changed.</li>}
        </ul>
      )}

      <div className="mt-3 border-t border-line pt-3">
        <Button size="sm" variant="ghost" className="min-h-11" onClick={() => { p.onKeepPlan(); setOpen(null); p.onClose(); }}>Keep my plan as it is</Button>
      </div>
    </section>
  );
}
