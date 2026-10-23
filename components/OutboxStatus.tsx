"use client";

import type { Outbox } from "@/lib/client/use-outbox";
import { describe } from "@/lib/client/outbox";

/**
 * The person's own waiting changes on this trip: "2 changes saved on your phone — will send when online", then "All waiting changes
 * were sent", or why one was refused. Shows nothing when there is nothing to say.
 */
export function OutboxStatus({ outbox, floating = false }: { outbox: Outbox; floating?: boolean }) {
  const n = outbox.items.length;
  if (n === 0 && !outbox.failed && !outbox.notice) return null;
  const box = floating ? "pointer-events-auto fixed inset-x-3 bottom-24 z-40 mx-auto max-w-md shadow-lg md:bottom-6" : "mx-auto max-w-3xl";
  return (
    <div className={`${box} space-y-2`}>
      {n > 0 && (
        <div role="status" aria-live="polite" className="rounded-xl border border-marigold/40 bg-marigold-light px-4 py-3 text-sm text-ink">
          <p className="font-semibold text-pine">
            {n === 1 ? "1 change is saved on your phone — it will be sent when you're online." : `${n} changes are saved on your phone — they will be sent when you're online.`}
            {outbox.syncing && " Sending…"}
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs text-ink-muted">
            {outbox.items.slice(-3).map((i) => <li key={`${i.kind}:${i.at}`}>{describe(i)}</li>)}
            {n > 3 && <li>and {n - 3} more</li>}
          </ul>
        </div>
      )}
      {outbox.failed && (
        <p role="alert" className="rounded-xl border border-clay/40 bg-clay-light px-4 py-3 text-sm font-medium text-clay-ink">
          {outbox.failed} <button type="button" onClick={outbox.clearFailed} className="tm-action ml-1 min-h-11 font-semibold">OK</button>
        </p>
      )}
      {n === 0 && outbox.notice && (
        <p role="status" className="rounded-xl border border-teal/30 bg-teal-light px-4 py-3 text-sm font-medium text-teal-ink">
          {outbox.notice} <button type="button" onClick={outbox.clearNotice} className="tm-action ml-1 min-h-11 font-semibold">OK</button>
        </p>
      )}
    </div>
  );
}
