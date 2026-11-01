"use client";

import type { ProposalDTO } from "@/lib/client/use-plan-change";

const KIND: Record<string, string> = { moved: "Moves", retimed: "New time", "proposed-removal": "Back to your ideas", "not-placed": "Doesn't fit" };

/** What a suggested change does, stop by stop and why, and what it rests on and what is uncertain. Shared by the options and the waiting suggestions. */
export function ProposalDetails({ o, onKeep }: { o: ProposalDTO; /** "Keep it instead" for a stop proposed to go back to Ideas. Absent: not offered. */ onKeep?: (stopId: string) => void }) {
  const changes = o.changes.filter((c) => c.kind !== "unchanged");
  return (
    <div className="mt-2 space-y-3 text-sm">
      {changes.length > 0 && (
        <div>
          <p className="font-semibold text-pine">What changes</p>
          <ul className="mt-1 space-y-1.5">
            {changes.map((c) => (
              <li key={c.id} className="min-w-0 break-words"><span className="font-semibold text-pine">{c.name}</span> <span className="text-xs font-bold uppercase tracking-wide text-ink-muted">{KIND[c.kind]}</span><br /><span className="text-ink-muted">{c.reason}</span>
                {c.kind === "proposed-removal" && onKeep && <button type="button" onClick={() => onKeep(c.id)} className="ml-2 min-h-11 font-semibold text-teal-ink underline underline-offset-2">Keep it instead</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {changes.length === 0 && <p className="text-ink-muted">None of your stops would move.</p>}
      {o.notPlaced.length > 0 && <div><p className="font-semibold text-clay-ink">What doesn&apos;t fit</p><ul className="mt-1 space-y-1">{o.notPlaced.map((n) => <li key={n.id} className="break-words text-ink-muted"><span className="font-semibold text-pine">{n.name}</span>: {n.reason}</li>)}</ul></div>}
      {o.bookingConflicts.length > 0 && <div><p className="font-semibold text-pine">Your bookings</p><ul className="mt-1 space-y-1">{o.bookingConflicts.map((b) => <li key={b.id} className="break-words text-ink-muted">{b.why}{b.confirmed ? "" : " (not confirmed, so this is a warning)"}</li>)}</ul></div>}
      {o.conditions.length > 0 && (
        <div>
          <p className="font-semibold text-pine">What the weather, hours and daylight say</p>
          <ul className="mt-1 space-y-1.5">{o.conditions.map((c) => <li key={c.id} className="break-words text-ink-muted"><span className="font-semibold text-pine">{c.title}.</span> {c.detail}{c.recommendation ? ` ${c.recommendation}` : ""}<br /><span className="text-xs">{c.source ?? ""}</span></li>)}</ul>
        </div>
      )}
      {o.conditions.length === 0 && o.atRisk.length > 0 && <div><p className="font-semibold text-pine">Worth checking</p><ul className="mt-1 space-y-1">{o.atRisk.map((r, i) => <li key={`${r.id}-${i}`} className="break-words text-ink-muted"><span className="font-semibold text-pine">{r.name}</span>: {r.why}</li>)}</ul></div>}
      {o.unresolved.length > 0 && <div><p className="font-semibold text-pine">What we&apos;re unsure of</p><ul className="mt-1 list-disc space-y-1 pl-5 text-ink-muted">{o.unresolved.map((u) => <li key={u} className="break-words">{u}</li>)}</ul><p className="mt-2 break-words text-xs text-ink-muted">{o.limitations.join(" ")}</p></div>}
    </div>
  );
}
