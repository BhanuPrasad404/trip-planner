"use client";

import type { PulseState } from "@/lib/client/use-pulse";
import { agoText } from "@/lib/feed/reality";
import { CROWD_LABEL } from "@/lib/feed/experience";
import { ChartIcon } from "./icons";

function Stat({ n, label }: { n: number; label: string }) {
  return <div className="rounded-2xl bg-sky px-3 py-3 text-center"><p className="font-display text-2xl font-semibold tabular-nums text-pine">{n}</p><p className="text-xs text-ink-muted">{label}</p></div>;
}

/**
 * What a destination is like RIGHT NOW, from what travelers recently posted, with the evidence shown and never more certainty than
 * there is. Used in the sheet (phones), the side panel (large screens) and the post page. Sentence-case headings, no shouting.
 */
export function PulseBody({ name, state, onRetry, onShare }: { name: string; state: PulseState; onRetry: () => void; onShare?: () => void }) {
  const data = state.data;
  const r = data?.reality;
  const asOfMs = data ? Date.parse(data.asOf) : 0;                       // the server's clock: every age here is measured from the same moment
  const crowdTone = r?.crowd.level === "quiet" ? "bg-teal-light text-teal-ink" : r?.crowd.level === "crowded" ? "bg-clay-light text-clay-ink" : "bg-marigold-light text-marigold-ink";

  return (
    <div className="space-y-5">
      {(state.status === "loading" || state.status === "idle") && !r && <div className="space-y-3" role="status" aria-label="Loading"><div className="h-16 animate-pulse rounded-2xl bg-sky" /><div className="h-24 animate-pulse rounded-2xl bg-sky" /></div>}
      {state.status === "error" && <p role="alert" className="text-sm text-clay-ink">Couldn&apos;t load this destination. <button type="button" onClick={onRetry} className="font-semibold underline">Try again</button></p>}

      {r && (
        <>
          <section aria-labelledby={`pulse-recent-${data!.destination.id}`}>
            <h3 id={`pulse-recent-${data!.destination.id}`} className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-muted"><ChartIcon size={15} />Recently shared</h3>
            {r.quiet ? (
              <div className="rounded-2xl bg-sky p-4 text-sm text-ink-muted">
                Nobody has posted from {name} this week, so we can&apos;t say what it&apos;s like right now.
                {onShare && <button type="button" onClick={onShare} className="mt-2 block font-semibold text-teal-ink underline underline-offset-2">Be the first to share</button>}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2"><Stat n={r.activity.today} label="today" /><Stat n={r.activity.week} label="this week" /><Stat n={r.activity.contributors} label="travelers" /></div>
            )}
            {!r.quiet && (r.activity.videos > 0 || r.activity.fromArea > 0) && (
              <p className="mt-2 text-xs text-ink-muted">{[r.activity.videos > 0 ? `${r.activity.videos} video${r.activity.videos === 1 ? "" : "s"}` : null, r.activity.fromArea > 0 ? `${r.activity.fromArea} posted from the area` : null].filter(Boolean).join(" · ")} this week</p>
            )}
          </section>

          <section aria-labelledby={`pulse-reality-${data!.destination.id}`}>
            <h3 id={`pulse-reality-${data!.destination.id}`} className="mb-2 text-sm font-semibold text-ink-muted">What travelers report</h3>
            <div className="space-y-3 rounded-2xl border border-line p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                {r.crowd.level ? <span className={`rounded-full px-3 py-1 text-sm font-semibold ${crowdTone}`}>{CROWD_LABEL[r.crowd.level]}</span> : <span className="rounded-full bg-sky px-3 py-1 text-sm font-semibold text-ink-muted">Crowd: unknown</span>}
                <p className="min-w-0 flex-1 text-sm text-ink-muted">{r.crowd.note}</p>
              </div>
              {r.conditions.length > 0 ? (
                <ul className="flex flex-wrap gap-2" aria-label="Current conditions reported by travelers">
                  {r.conditions.map((c) => (
                    <li key={c.id} className={`rounded-2xl px-3 py-1.5 text-sm ${c.warning ? "bg-marigold-light text-marigold-ink" : "bg-teal-light text-teal-ink"}`}>
                      <strong>{c.warning ? "! " : ""}{c.label}</strong><span className="block text-xs opacity-80">{agoText(c.ageMs)}{c.reports > 1 ? ` · ${c.reports} travelers` : ""}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-ink-muted">No current condition reports.</p>}
              <p className="text-xs text-ink-muted">Community-reported, not guaranteed. Each kind of report expires on its own: a queue after a few hours, a closure after a day or so.</p>
            </div>
          </section>

          {r.vibes.length > 0 && (
            <section aria-labelledby={`pulse-vibes-${data!.destination.id}`}>
              <h3 id={`pulse-vibes-${data!.destination.id}`} className="mb-2 text-sm font-semibold text-ink-muted">Travelers say it&apos;s good for</h3>
              <ul className="flex flex-wrap gap-2">{r.vibes.map((v) => <li key={v.id} className="rounded-full border border-line px-3 py-1.5 text-sm text-pine">{v.label} <span className="text-xs text-ink-muted">· {v.n}</span></li>)}</ul>
            </section>
          )}

          {r.tips.length > 0 && (
            <section aria-labelledby={`pulse-tips-${data!.destination.id}`}>
              <h3 id={`pulse-tips-${data!.destination.id}`} className="mb-2 text-sm font-semibold text-ink-muted">Tips from travelers</h3>
              <ul className="space-y-2">{r.tips.map((t) => <li key={`${t.at}-${t.text}`} className="rounded-2xl border-l-4 border-teal bg-sky px-3.5 py-2.5 text-sm text-ink">{t.text}<span className="mt-0.5 block text-xs text-ink-muted">{t.by ? `@${t.by} · ` : ""}{agoText(Math.max(0, asOfMs - Date.parse(t.at)))}</span></li>)}</ul>
            </section>
          )}

          <p className="text-xs text-ink-muted">Based on {r.activity.total30d} post{r.activity.total30d === 1 ? "" : "s"} in the last 30 days{r.activity.tripAdds > 0 ? ` · added to ${r.activity.tripAdds} trip${r.activity.tripAdds === 1 ? "" : "s"}` : ""}.</p>
        </>
      )}
    </div>
  );
}
