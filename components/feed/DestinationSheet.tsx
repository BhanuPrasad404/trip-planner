"use client";

import { useCallback, useEffect, useState } from "react";
import type { Reality } from "@/lib/feed/reality";
import { agoText } from "@/lib/feed/reality";
import { CROWD_LABEL } from "@/lib/feed/experience";
import { googleMapsPlace } from "@/lib/maps-links";
import { Sheet } from "./Sheet";
import { ChartIcon, PinIcon, PlusIcon } from "./icons";

type Payload = { destination: { id: string; name: string; lat: number; lng: number }; reality: Reality; asOf: string };

function Stat({ n, label }: { n: number; label: string }) {
  return <div className="rounded-2xl bg-sky/70 px-3 py-3 text-center"><p className="font-display text-2xl font-semibold tabular-nums text-pine">{n}</p><p className="text-xs text-ink-muted">{label}</p></div>;
}

/** What a destination is like RIGHT NOW, from what travelers recently posted — with the evidence shown, never more certainty than there is. */
export function DestinationSheet({ destinationId, name, onClose, onAddToTrip, onShare }: { destinationId: string; name: string; onClose: () => void; onAddToTrip: () => void; onShare: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const fetchIt = useCallback(async () => {
    const res = await fetch(`/api/destinations/${destinationId}/pulse`);
    const b = await res.json().catch(() => null);
    if (!res.ok) throw new Error(b?.error ?? "Couldn't load this destination.");
    return b as Payload;
  }, [destinationId]);

  useEffect(() => {
    let live = true;
    fetchIt().then((b) => { if (live) { setData(b); setState("ready"); } }).catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [fetchIt]);

  const r = data?.reality;
  const asOfMs = data ? Date.parse(data.asOf) : 0;          // the server's clock, so every age on this screen is measured from the same moment
  const crowdTone = r?.crowd.level === "quiet" ? "bg-teal-light text-teal-ink" : r?.crowd.level === "crowded" ? "bg-clay-light text-clay-ink" : "bg-marigold-light text-[#7a4a00]";

  return (
    <Sheet title={name} onClose={onClose}>
      <div className="space-y-6 px-4 py-4">
        {state === "loading" && <div className="space-y-3" role="status" aria-label="Loading">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-sky" />)}</div>}
        {state === "error" && <p role="alert" className="text-sm text-clay-ink">Couldn&apos;t load this destination. <button type="button" onClick={() => { setState("loading"); fetchIt().then((b) => { setData(b); setState("ready"); }).catch(() => setState("error")); }} className="font-semibold underline">Try again</button></p>}

        {r && (
          <>
            <section aria-labelledby="pulse-recent">
              <h3 id="pulse-recent" className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-muted"><ChartIcon size={14} />Recently shared</h3>
              {r.quiet ? (
                <div className="rounded-2xl bg-sky/70 p-4 text-sm text-ink-muted">
                  Nobody has posted from {name} this week, so we can&apos;t say what it&apos;s like right now.
                  <button type="button" onClick={() => { onClose(); onShare(); }} className="mt-2 block font-semibold text-teal-ink underline underline-offset-2">Be the first to share →</button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2"><Stat n={r.activity.today} label="today" /><Stat n={r.activity.week} label="this week" /><Stat n={r.activity.contributors} label="travelers" /></div>
              )}
              {!r.quiet && (r.activity.videos > 0 || r.activity.fromArea > 0) && (
                <p className="mt-2 text-xs text-ink-muted">{[r.activity.videos > 0 ? `${r.activity.videos} video${r.activity.videos === 1 ? "" : "s"}` : null, r.activity.fromArea > 0 ? `${r.activity.fromArea} posted from the area` : null].filter(Boolean).join(" · ")} this week</p>
              )}
            </section>

            <section aria-labelledby="pulse-reality">
              <h3 id="pulse-reality" className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Traveler reality</h3>
              <div className="space-y-3 rounded-2xl border border-line p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  {r.crowd.level ? <span className={`rounded-full px-3 py-1 text-sm font-semibold ${crowdTone}`}>{CROWD_LABEL[r.crowd.level]}</span> : <span className="rounded-full bg-sky px-3 py-1 text-sm font-semibold text-ink-muted">Crowd: unknown</span>}
                  <p className="min-w-0 flex-1 text-sm text-ink-muted">{r.crowd.note}</p>
                </div>
                {r.conditions.length > 0 ? (
                  <ul className="flex flex-wrap gap-2" aria-label="Current conditions reported by travelers">
                    {r.conditions.map((c) => (
                      <li key={c.id} className={`rounded-2xl px-3 py-1.5 text-sm ${c.warning ? "bg-marigold-light text-[#7a4a00]" : "bg-teal-light text-teal-ink"}`}>
                        <strong>{c.label}</strong><span className="block text-xs opacity-80">{agoText(c.ageMs)}{c.reports > 1 ? ` · ${c.reports} travelers` : ""}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-ink-muted">No current condition reports.</p>}
                <p className="text-xs text-ink-muted">Community-reported, not guaranteed. Each kind of report expires on its own — a queue after a few hours, a closure after a day or so.</p>
              </div>
            </section>

            {r.vibes.length > 0 && (
              <section aria-labelledby="pulse-vibes">
                <h3 id="pulse-vibes" className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Travelers say it&apos;s good for</h3>
                <ul className="flex flex-wrap gap-2">{r.vibes.map((v) => <li key={v.id} className="rounded-full border border-line px-3 py-1.5 text-sm text-pine">{v.label} <span className="text-xs text-ink-muted">· {v.n}</span></li>)}</ul>
              </section>
            )}

            {r.tips.length > 0 && (
              <section aria-labelledby="pulse-tips">
                <h3 id="pulse-tips" className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Tips from travelers</h3>
                <ul className="space-y-2">{r.tips.map((t) => <li key={`${t.at}-${t.text}`} className="rounded-2xl bg-sky/70 px-3.5 py-2.5 text-sm text-ink">{t.text}<span className="mt-0.5 block text-xs text-ink-muted">{t.by ? `@${t.by} · ` : ""}{agoText(Math.max(0, asOfMs - Date.parse(t.at)))}</span></li>)}</ul>
              </section>
            )}

            <p className="text-xs text-ink-muted">Based on {r.activity.total30d} post{r.activity.total30d === 1 ? "" : "s"} in the last 30 days{r.activity.tripAdds > 0 ? ` · added to ${r.activity.tripAdds} trip${r.activity.tripAdds === 1 ? "" : "s"}` : ""}.</p>

            <div className="flex flex-wrap gap-2.5">
              <button type="button" onClick={() => { onClose(); onAddToTrip(); }} className="inline-flex min-h-12 items-center gap-1.5 rounded-full bg-teal px-6 text-sm font-semibold text-white active:scale-95 transition-transform"><PlusIcon size={18} />Add to trip</button>
              <a href={googleMapsPlace(data!.destination)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center gap-1.5 rounded-full border border-line px-5 text-sm font-semibold text-pine"><PinIcon size={18} />Open map<span className="sr-only"> (opens in a new tab)</span></a>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
