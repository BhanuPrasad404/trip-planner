"use client";

// "Plan it for me": for a traveller who named a place (Tirupati) and little else. Three ready plans made of real places round it, each stop
// with the reason it is there, each day with its driving. Nothing is added until the traveller taps "Use this plan" (or Add on one stop).
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CategoryGlyph } from "@/components/ui/Glyph";
import { Glyph } from "@/components/ui/Glyph";
import { Skeleton } from "@/components/ui/Skeleton";
import { exploreCategoryLabel } from "@/lib/explore/categories";
import type { Ask, Pick, PlanId, ProposedPlan } from "@/lib/intake/propose";
import type { ProposeAnswer } from "@/lib/intake/propose-service";
import { placeCategoryFor } from "@/lib/intake/propose";
import { PlaceHours, exploreItemRef } from "@/components/place/PlaceHours";
import { addDaysISO } from "@/lib/result/trip-clock";

export type ProposeInput = { hub: Ask["hub"]; /** Where the trip starts, so a faraway hub is said plainly. */ start?: Ask["hub"] | null; roundTrip?: boolean; days: number; group: Ask["group"]; interests: Ask["interests"]; pace: Ask["pace"]; maxDriveHours: Ask["maxDriveHours"] };
const hm = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`);

export function ProposePanel({ input, online, added, onUse, onAdd, defaultPlan, onDays, startDate }: {
  input: ProposeInput; online: boolean;
  /** The trip's first day (YYYY-MM-DD), so each stop's hours are for its own day. Without it, hours are for today (changeable). */
  startDate?: string | null;
  /** Given when the traveller has not said how many days: the panel then asks, with one tap. */
  onDays?: (days: number) => void;
  /** Ids (osm:…) of the places already in the trip, so the panel shows them as added. */
  added: ReadonlySet<string>;
  onUse: (plan: ProposedPlan) => void; onAdd: (p: Pick) => void;
  defaultPlan?: PlanId;
}) {
  const [state, setState] = useState<{ key: string; status: "loading" | "done" | "error"; answer: ProposeAnswer | null } | null>(null);
  const [planId, setPlanId] = useState<PlanId>(defaultPlan ?? "balanced");
  const [used, setUsed] = useState<PlanId | null>(null);
  const [retry, setRetry] = useState(0);
  const ctrl = useRef<AbortController | null>(null);
  /** One quiet retry when the free map servers were slow: a second look usually finds the first one finished. */
  const [autoTried, setAutoTried] = useState(false);
  const key = JSON.stringify([input.hub.lat.toFixed(3), input.hub.lng.toFixed(3), input.start ? [input.start.lat.toFixed(2), input.start.lng.toFixed(2)] : null, input.roundTrip, input.days, input.group, input.interests, input.maxDriveHours, retry]);

  useEffect(() => {
    if (!online) return;
    const t = setTimeout(() => {
      ctrl.current?.abort();
      const c = new AbortController(); ctrl.current = c;
      setState({ key, status: "loading", answer: null });
      fetch("/api/intake/propose", { method: "POST", headers: { "Content-Type": "application/json" }, signal: c.signal, body: JSON.stringify({ hub: input.hub, start: input.start ?? null, round_trip: input.roundTrip ?? true, days: input.days, group: input.group, interests: input.interests, pace: null, max_drive_hours: input.maxDriveHours }) })
        .then(async (r) => { const b = (await r.json().catch(() => null)) as (ProposeAnswer & { error?: string }) | null; if (!r.ok || !b) throw new Error(b?.error ?? "failed"); setState({ key, status: "done", answer: b }); setUsed(null); })
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
  const plans = current?.answer?.plans ?? [];
  const plan = plans.find((p) => p.id === planId) ?? plans[1] ?? plans[0] ?? null;
  const days = current?.answer?.sightDays ?? input.days;

  return (
    <section aria-labelledby="h-propose" className="rounded-2xl border-2 border-teal/40 bg-white p-4 shadow-sm">
      <p className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-widest text-marigold"><Glyph name="wand" size={14} />Plan it for me</p>
      <h2 id="h-propose" className="mt-1 text-balance font-display text-xl font-semibold leading-snug text-pine">{`Not sure what to see around ${input.hub.name}?`}</h2>
      <p className="mt-1 text-sm text-ink-muted">{`Here are three ready plans for ${days} ${days === 1 ? "day" : "days"} of sights, made only of real places on the map. Pick one, then change anything.`}</p>

      {onDays && (
        <fieldset className="mt-3">
          <legend className="text-sm font-semibold text-ink">How many days?</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button key={n} type="button" aria-pressed={input.days === n} onClick={() => onDays(n)} className={`min-h-11 min-w-11 rounded-full border px-3.5 text-sm font-bold ${input.days === n ? "border-2 border-pine bg-teal-light/50 text-pine" : "border-line bg-white text-ink hover:border-teal"}`}>{n}</button>
            ))}
          </div>
        </fieldset>
      )}

      {!online && <p role="status" className="mt-3 rounded-xl bg-sky px-3.5 py-2.5 text-sm text-ink-muted">You&apos;re offline. Planning round a place needs the internet.</p>}

      {online && (!current || current.status === "loading") && (
        <div aria-busy="true" role="status" className="mt-3 space-y-2.5">
          <p className="text-sm font-semibold text-ink-muted">{`Looking round ${input.hub.name} for places worth your time…`}</p>
          <p className="text-xs text-ink-muted">The first look at a new place can take up to 40 seconds.</p>
          <Skeleton className="h-16 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" />
        </div>
      )}

      {current?.status === "error" && (
        <div role="alert" className="mt-3 rounded-xl border border-clay/30 bg-clay-light px-3.5 py-3 text-sm font-medium text-clay-ink">
          <p>We couldn&apos;t look round {input.hub.name} just now. Check your connection and try again, or add places yourself below.</p>
          <button type="button" onClick={() => setRetry((n) => n + 1)} className="tm-action mt-1 min-h-11 font-bold">Try again</button>
        </div>
      )}

      {current?.status === "done" && plans.length === 0 && (
        <div role="status" className="mt-3 rounded-xl border border-marigold/50 bg-marigold-light/60 px-3.5 py-3 text-sm text-[#7a4a00]">
          <p>{current.answer?.note ?? "We couldn't find places to suggest."}</p>
          {current.answer?.status === "unavailable" && !autoTried && <p className="mt-1 text-xs">We&apos;ll look once more in a few seconds.</p>}
          {current.answer?.status === "unavailable" && <button type="button" onClick={() => setRetry((n) => n + 1)} className="tm-action mt-1 min-h-11 font-bold">Try again</button>}
          {current.answer?.reason && (
            <details open={process.env.NODE_ENV !== "production"} className="mt-1 text-xs text-ink-muted">
              <summary className="min-h-11 cursor-pointer py-3 font-semibold text-ink">Details (for support)</summary>
              <p className="break-words">{current.answer.reason}</p>
              {current.answer.hint && <p className="mt-1 break-words font-semibold text-ink">{current.answer.hint}</p>}
            </details>
          )}
        </div>
      )}

      {current?.status === "done" && plan && (
        <>
          {current.answer?.note && <p role="status" className="mt-3 flex items-start gap-1.5 rounded-xl bg-sky px-3.5 py-2.5 text-sm text-ink-muted"><Glyph name="info" size={15} className="mt-0.5" />{current.answer.note}</p>}

          <div role="tablist" aria-label="Choose a plan" className="mt-3 grid grid-cols-3 gap-1.5">
            {plans.map((p) => {
              const on = p.id === plan.id;
              return (
                <button key={p.id} type="button" role="tab" aria-selected={on} onClick={() => setPlanId(p.id)} className={`min-h-[4rem] min-w-0 rounded-xl border px-1.5 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40 ${on ? "border-2 border-pine bg-teal-light/50" : "border-line bg-white hover:border-teal"}`}>
                  <span className="block break-words text-sm font-bold text-pine">{p.title}</span>
                  <span className="block text-[11px] text-ink-muted">{p.count} {p.count === 1 ? "place" : "places"}</span>
                </button>
              );
            })}
          </div>

          <div role="tabpanel" aria-label={`${plan.title} plan`} className="mt-3 space-y-3">
            <p className="text-sm text-ink-muted">{plan.blurb}. About {hm(plan.driveMin)} of driving in total{current.answer?.roadTimes === "estimate" ? " (estimated)" : ""}, each day starting and ending in {input.hub.name}.</p>
            {plan.notes.map((n) => <p key={n} className="text-sm text-[#7a4a00]">{n}</p>)}

            {plan.days.map((d) => (
              <article key={d.day} aria-label={d.title} className="rounded-xl border border-line bg-sky/40 p-3">
                <h3 className="break-words text-base font-bold text-pine">{d.title}</h3>
                <p className="flex items-center gap-1.5 text-xs text-ink-muted"><Glyph name="car" size={13} />About {hm(d.driveMin)} driving that day</p>
                <ul className="mt-2 space-y-2">
                  {d.picks.map((k) => {
                    const done = added.has(k.id);
                    return (
                      <li key={k.id} className="rounded-xl bg-white p-3">
                        <div className="flex items-start gap-2.5">
                          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-light text-teal-ink"><CategoryGlyph category={placeCategoryFor(k.category)} size={17} /></span>
                          <div className="min-w-0 flex-1">
                            <p className="break-words font-semibold leading-snug text-pine">{k.name}</p>
                            <p className="text-xs text-ink-muted">{exploreCategoryLabel(k.category)}</p>
                          </div>
                        </div>
                        <ul className="mt-2 space-y-1 text-sm text-ink">
                          {k.why.map((w) => <li key={w} className="flex items-start gap-1.5"><Glyph name="check" size={13} className="mt-1 text-teal" /><span className="min-w-0 break-words">{w}</span></li>)}
                          {k.source && <li className="text-xs text-ink-muted">Source: {k.source}</li>}
                        </ul>
                        <details className="mt-1 text-sm"><summary className="min-h-11 cursor-pointer py-2 font-semibold text-teal-ink">Opening hours{startDate ? ` on day ${d.day}` : ""}</summary>
                          <PlaceHours place={exploreItemRef(k)} date={startDate ? addDaysISO(startDate, d.day - 1) : null} />
                        </details>
                        <button type="button" onClick={() => onAdd(k)} disabled={done} aria-label={done ? `${k.name} is in your trip` : `Add ${k.name} to your trip`} className={`mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-semibold disabled:cursor-default ${done ? "border-teal bg-teal-light/50 text-teal-ink" : "border-line bg-white text-pine hover:border-teal"}`}>
                          <Glyph name={done ? "check" : "plus"} size={14} />{done ? "In your trip" : "Add this one"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </article>
            ))}

            <Button onClick={() => { onUse(plan); setUsed(plan.id); }} className="w-full" disabled={plan.count === 0}>
              {used === plan.id ? <><Glyph name="check" size={16} />Added: change anything below</> : `Use the ${plan.title} plan`}
            </Button>
            <p className="text-xs text-ink-muted">Places come from OpenStreetMap, and “well known” means it has a Wikipedia, Wikidata or heritage entry. We don&apos;t check crowds or reviews. Drive times include a 15% safety margin.</p>
          </div>
        </>
      )}
    </section>
  );
}
