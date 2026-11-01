"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ProposalDetails } from "@/components/ProposalDetails";
import type { PendingSuggestion } from "@/lib/client/use-plan-change";

type Props = {
  pending: PendingSuggestion[];
  /** The trip's owner: the only person who may approve or decline. */
  isOwner: boolean;
  busy: number | null;
  error: string | null;
  onApprove: (rev: number) => void;
  onDecline: (rev: number) => void;
};

/**
 * Changes to the shared plan that someone on the trip has suggested and nobody has answered. Everyone sees them (so the group knows what is
 * on the table); only the trip owner gets the buttons, and the server refuses anyone else. Nothing here has changed the plan.
 */
export function PendingSuggestions(p: Props) {
  const [open, setOpen] = useState<number | null>(null);
  if (p.pending.length === 0) return null;
  return (
    <section aria-labelledby="pending-heading" className="rounded-2xl border border-marigold/40 bg-marigold-light px-4 py-4 text-[#5c3a00]" data-testid="pending-suggestions">
      <h2 id="pending-heading" className="font-semibold">{p.isOwner ? (p.pending.length === 1 ? "A change is waiting for you" : `${p.pending.length} changes are waiting for you`) : "A change has been suggested to the trip owner"}</h2>
      <p className="mt-0.5 text-sm">{p.isOwner ? "Someone on the trip suggested this. Nothing has changed until you approve it." : "Only the trip owner can approve or decline changes to the shared plan. Nothing has changed."}</p>
      {p.error && <p role="alert" className="mt-2 rounded-xl bg-clay-light px-3 py-2 text-sm font-medium text-clay-ink">{p.error}</p>}
      <ul className="mt-3 space-y-3">
        {p.pending.map((s) => (
          <li key={s.rev} className="rounded-xl border border-line bg-white p-3 text-ink">
            <h3 className="break-words text-base font-semibold text-pine">{s.proposal.label}</h3>
            <p className="text-xs text-ink-muted">Suggested by {s.mine ? "you" : s.suggestedBy.name}</p>
            <p className="mt-1 break-words text-sm text-ink-muted">{s.proposal.summary}</p>
            <button type="button" onClick={() => setOpen(open === s.rev ? null : s.rev)} aria-expanded={open === s.rev} className="mt-1 min-h-11 text-sm font-semibold text-teal-ink underline underline-offset-2">{open === s.rev ? "Hide the details" : "See what changes"}</button>
            {open === s.rev && <ProposalDetails o={s.proposal} />}
            {p.isOwner && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => p.onApprove(s.rev)} loading={p.busy === s.rev} loadingLabel="Applying…" disabled={p.busy !== null} className="min-h-11">Approve this change</Button>
                <Button size="sm" variant="secondary" onClick={() => p.onDecline(s.rev)} disabled={p.busy !== null} className="min-h-11">Decline</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
