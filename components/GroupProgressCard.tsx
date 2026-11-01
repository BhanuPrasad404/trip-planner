"use client";

import { timeText, dateText } from "@/lib/trip/journey";
import type { MemberProgress } from "@/lib/trip/group";

type Props = { members: MemberProgress[]; offsetMin: number };

const when = (iso: string | null, offsetMin: number) => (iso ? `${timeText(iso, offsetMin)}, ${dateText(Date.parse(iso), offsetMin)}` : "");

/** Where each person on the trip is in their OWN journey: only what they themselves tapped, never a position. Hidden for a trip of one. */
export function GroupProgressCard({ members, offsetMin }: Props) {
  if (members.length < 2) return null;
  return (
    <section aria-labelledby="group-heading" className="rounded-2xl border border-line bg-white p-4 sm:p-5" data-testid="group-card">
      <details>
        <summary className="min-h-11 cursor-pointer select-none py-2"><h2 id="group-heading" className="inline font-display text-lg font-semibold text-pine">The group ({members.length})</h2></summary>
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.userId} className="min-w-0 py-2.5">
              <p className="break-words text-sm font-semibold text-pine">{m.name}{m.you ? " (you)" : ""}</p>
              <p className="break-words text-sm text-ink-muted">
                {m.state === "awaiting-departure" ? "Hasn't set off yet" : m.state === "travelling" ? `On the road since ${when(m.since, offsetMin)}` : m.state === "paused" ? `Paused since ${when(m.since, offsetMin)}` : `Resting since ${when(m.since, offsetMin)}`}
                {m.atPlace ? ` · at ${m.atPlace.name ?? "a stop"} since ${timeText(m.atPlace.arrivedAt, offsetMin)}` : ""}
              </p>
              {(m.visited > 0 || m.skipped > 0) && <p className="text-xs text-ink-muted">{m.visited} visited{m.skipped ? `, ${m.skipped} skipped` : ""} by them</p>}
            </li>
          ))}
        </ul>
        <p className="mt-2 break-words text-xs text-ink-muted">Each person&apos;s journey is their own: someone arriving or pausing doesn&apos;t mean everyone has. Marking a stop done is for the whole group. This shows only what people tapped, never where anyone is.</p>
      </details>
    </section>
  );
}
