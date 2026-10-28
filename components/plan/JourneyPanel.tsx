"use client";

// "On your way": the traveller starts far from where they are going (Hyderabad → Goa) and wants worthwhile stops along the road. Real places
// along the real road, spread out, each with how far along the road it is and how much extra driving it costs. Nothing is added until tapped.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CategoryGlyph, Glyph } from "@/components/ui/Glyph";
import { Skeleton } from "@/components/ui/Skeleton";
import { exploreCategoryLabel } from "@/lib/explore/categories";
import type { Hub } from "@/lib/intake/propose";
import { placeCategoryFor } from "@/lib/intake/propose";
import { kindsForInterests, type JourneyStop } from "@/lib/intake/journey";
import type { JourneyAnswer } from "@/lib/intake/journey-service";
import type { Interest } from "@/lib/intake/types";

export type JourneyInput = { start: Hub; dest: Hub; interests: Interest[]; maxDriveHours: number | null; roundTrip: boolean; /** Big states the traveller named (Karnataka): the road goes through them. */ via: string[] };

export function JourneyPanel({ input, online, added, onAdd, onAddAll }: { input: JourneyInput; online: boolean; added: ReadonlySet<string>; onAdd: (s: JourneyStop) => void; onAddAll: (s: JourneyStop[]) => void }) {
  const [state, setState] = useState<{ key: string; status: "loading" | "done" | "error"; answer: JourneyAnswer | null } | null>(null);
  const [retry, setRetry] = useState(0);
  const [autoTried, setAutoTried] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const key = JSON.stringify([input.start.lat.toFixed(3), input.start.lng.toFixed(3), input.dest.lat.toFixed(3), input.dest.lng.toFixed(3), input.interests, input.maxDriveHours, input.roundTrip, retry]);

  useEffect(() => {
    if (!online) return;
    const t = setTimeout(() => {
      ctrl.current?.abort();
      const c = new AbortController(); ctrl.current = c;
      setState({ key, status: "loading", answer: null });
      fetch("/api/intake/journey", { method: "POST", headers: { "Content-Type": "application/json" }, signal: c.signal, body: JSON.stringify({ start: input.start, dest: input.dest, interests: input.interests, max_drive_hours: input.maxDriveHours, round_trip: input.roundTrip }) })
        .then(async (r) => { const b = (await r.json().catch(() => null)) as (JourneyAnswer & { error?: string }) | null; if (!r.ok || !b) throw new Error(b?.error ?? "failed"); setState({ key, status: "done", answer: b }); })
        .catch(() => { if (!c.signal.aborted) setState({ key, status: "error", answer: null }); });
    }, 500);
    return () => { clearTimeout(t); ctrl.current?.abort(); };
  }, [key, online]); // eslint-disable-line react-hooks/exhaustive-deps -- the key covers the input

  const current = state?.key === key ? state : null;
  useEffect(() => {
    if (current?.status !== "done" || current.answer?.status !== "unavailable" || autoTried) return;
    const t = setTimeout(() => { setAutoTried(true); setRetry((n) => n + 1); }, 6000);
    return () => clearTimeout(t);
  }, [current, autoTried]);

  const answer = current?.status === "done" ? current.answer : null;
  if (answer?.status === "too_close") return null;                       // too near for a "way": nothing to say
  const kinds = kindsForInterests(input.interests);
  const what = kinds.length ? exploreCategoryLabel(kinds[0]) : "Worth a stop";
  const title = `${what} on your way to ${input.dest.name}`;
  const stops = answer?.stops ?? [];
  const days = [...new Set(stops.map((s) => s.drivingDay))].sort((a, b) => a - b);

  return (
    <section aria-labelledby="h-journey" className="rounded-2xl border-2 border-marigold/50 bg-white p-4 shadow-sm">
      <p className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-widest text-marigold"><Glyph name="navigate" size={14} />On your way</p>
      <h2 id="h-journey" className="mt-1 text-balance font-display text-xl font-semibold leading-snug text-pine">{title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{`${input.start.name} to ${input.dest.name} is a long drive. These are real places on the road itself, spread out so you can break the journey.`}</p>
      {input.via.length > 0 && <p className="mt-1 text-sm text-ink-muted">{`You mentioned ${input.via.join(" and ")}: the road to ${input.dest.name} goes through ${input.via.length === 1 ? "it" : "them"}, so you don't need to add ${input.via.length === 1 ? "it as a place" : "them as places"}.`}</p>}

      {!online && <p role="status" className="mt-3 rounded-xl bg-sky px-3.5 py-2.5 text-sm text-ink-muted">You&apos;re offline. Looking along the road needs the internet.</p>}

      {online && (!current || current.status === "loading") && (
        <div aria-busy="true" role="status" className="mt-3 space-y-2.5">
          <p className="text-sm font-semibold text-ink-muted">{`Looking along the road to ${input.dest.name}…`}</p>
          <p className="text-xs text-ink-muted">The first look at a new road can take up to 40 seconds.</p>
          <Skeleton className="h-16 w-full" /><Skeleton className="h-24 w-full" />
        </div>
      )}

      {current?.status === "error" && (
        <div role="alert" className="mt-3 rounded-xl border border-clay/30 bg-clay-light px-3.5 py-3 text-sm font-medium text-clay-ink">
          <p>We couldn&apos;t look along the road just now. Check your connection and try again.</p>
          <button type="button" onClick={() => setRetry((n) => n + 1)} className="tm-action mt-1 min-h-11 font-bold">Try again</button>
        </div>
      )}

      {answer && answer.note && (
        <p role="status" className={`mt-3 flex items-start gap-1.5 rounded-xl px-3.5 py-2.5 text-sm ${answer.status === "ok" ? "bg-sky text-ink-muted" : "border border-marigold/50 bg-marigold-light/60 text-[#7a4a00]"}`}>
          <Glyph name="info" size={15} className="mt-0.5" /><span className="min-w-0">{answer.note}</span>
        </p>
      )}
      {answer?.status === "unavailable" && (
        <div className="mt-1">
          {!autoTried && <p className="text-xs text-ink-muted">We&apos;ll look once more in a few seconds.</p>}
          <button type="button" onClick={() => setRetry((n) => n + 1)} className="tm-action min-h-11 font-bold">Try again</button>
          {answer.reason && (
            <details open={process.env.NODE_ENV !== "production"} className="text-xs text-ink-muted">
              <summary className="min-h-11 cursor-pointer py-3 font-semibold text-ink">Details (for support)</summary>
              <p className="break-words">{answer.reason}</p>
              {answer.hint && <p className="mt-1 break-words font-semibold text-ink">{answer.hint}</p>}
            </details>
          )}
        </div>
      )}

      {answer?.status === "ok" && (
        <div className="mt-3 space-y-3">
          {days.map((d) => (
            <article key={d} aria-label={`Driving day ${d}`} className="rounded-xl border border-line bg-sky/40 p-3">
              <h3 className="text-base font-bold text-pine">{`Driving day ${d}`}</h3>
              <ul className="mt-2 space-y-2">
                {stops.filter((s) => s.drivingDay === d).map((k) => {
                  const done = added.has(k.id);
                  return (
                    <li key={k.id} className="rounded-xl bg-white p-3">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-marigold-light text-marigold-ink"><CategoryGlyph category={placeCategoryFor(k.category)} size={17} /></span>
                        <div className="min-w-0 flex-1">
                          <p className="break-words font-semibold leading-snug text-pine">{k.name}</p>
                          <p className="text-xs text-ink-muted">{exploreCategoryLabel(k.category)}</p>
                        </div>
                      </div>
                      <ul className="mt-2 space-y-1 text-sm text-ink">
                        {k.why.map((w) => <li key={w} className="flex items-start gap-1.5"><Glyph name="check" size={13} className="mt-1 text-teal" /><span className="min-w-0 break-words">{w}</span></li>)}
                        {k.hours && <li className="flex items-start gap-1.5 text-ink-muted"><Glyph name="recent" size={13} className="mt-1" /><span className="min-w-0 break-words">Hours on the map: {k.hours}</span></li>}
                      </ul>
                      <button type="button" onClick={() => onAdd(k)} disabled={done} aria-label={done ? `${k.name} is in your trip` : `Add ${k.name} to your trip`} className={`mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-semibold disabled:cursor-default ${done ? "border-teal bg-teal-light/50 text-teal-ink" : "border-line bg-white text-pine hover:border-teal"}`}>
                        <Glyph name={done ? "check" : "plus"} size={14} />{done ? "In your trip" : "Add this stop"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
          <Button onClick={() => onAddAll(stops)} className="w-full" disabled={stops.every((s) => added.has(s.id))}>
            {stops.every((s) => added.has(s.id)) ? <><Glyph name="check" size={16} />All stops added</> : `Add all ${stops.length} stops`}
          </Button>
          <p className="text-xs text-ink-muted">Places come from OpenStreetMap; “well known” means a Wikipedia, Wikidata or heritage entry. We don&apos;t check crowds, queues or reviews. The same road works on the way back{input.roundTrip ? "" : " if you return"}. Drive times include a 15% safety margin.</p>
        </div>
      )}
    </section>
  );
}
