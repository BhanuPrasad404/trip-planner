"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { Spinner } from "@/components/ui/Spinner";
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
import { snapshotPlaces } from "@/lib/snapshot";
import { PRIORITIES, duration, hhmm, type BuilderResult, type DayPlan, type PlanOption, type Warning } from "@/lib/trip-builder";
import { PRIORITY_UI, dayPressure, distinctPlans, joinLabels, paceFacts, paceRules, recommendOption } from "@/lib/trip-builder/recommend";
import type { EndMode } from "@/lib/trip-builder/types";
import type { PlaceWithSeason } from "@/lib/types";
import { formatDate } from "@/lib/format";
import type { DurationAdvice } from "@/lib/trip-builder/duration";
import { parseISODate } from "@/lib/dates";
import type { EngineView, NightHalt } from "@/lib/engine/types";
import { FuelCard, HaltLine, PlanLabels, TransitDayCard, WhatIfStepper } from "./EngineExtras";
import { Select } from "@/components/ui/Select";

type Props = {
  tripId: string;
  places: PlaceWithSeason[];
  hasStart: boolean;
  hasDestination: boolean;
  /** Names used in the "where does it end?" choices. */
  startLabel?: string | null;
  destLabel?: string | null;
  /** Where the plan should end at first: the trip's own end choice (lib/trip/end.ts). The traveller can still change it here. */
  defaultEndMode?: EndMode;
  /** The signed-in person owns the trip (only the owner can change its length). */
  canEditTrip?: boolean;
  /** The trip has a start date (so opening days, weather and season could be considered). */
  hasDates?: boolean;
  /** Close the panel. */
  onClose?: () => void;
  /** Show this plan on the map (null = back to the saved plan). */
  onPreview: (option: PlanOption | null) => void;
  onChanged: () => void;
};

type Loaded = { result: BuilderResult; signature: string; duration: DurationAdvice | null; /** The Phase 3 engine's extras (null when it fell back to the builder). */ engine: EngineView | null };

const intensityStyle: Record<DayPlan["intensity"], { chip: string; bar: string; label: string }> = {
  comfortable: { chip: "bg-teal-light text-teal-ink", bar: "bg-teal", label: "Easy" },
  moderate: { chip: "bg-sky text-pine", bar: "bg-[#6aa6c9]", label: "Moderate" },
  heavy: { chip: "bg-marigold-light text-[#7a4a00]", bar: "bg-marigold", label: "Heavy" },
  overloaded: { chip: "bg-clay-light text-clay-ink", bar: "bg-clay", label: "Too much" },
};
/** "45 min", "1 h", "2.5 h": short enough for a dropdown on a small phone. */
const short = (m: number) => (m < 60 ? `${m} min` : `${Math.round((m / 60) * 10) / 10} h`);
const sevStyle: Record<Warning["severity"], string> = { risk: "border-clay/40 bg-clay-light/60 text-clay-ink", warn: "border-marigold/50 bg-marigold-light/60 text-[#7a4a00]", info: "border-line bg-sky/60 text-ink-muted" };

async function post<T>(url: string, body: unknown, method = "POST"): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? { ok: true, data: json } : { ok: false, error: json.error ?? "Something went wrong. Please try again." };
  } catch {
    return { ok: false, error: "No connection. Please try again." };
  }
}

export function TripBuilder({ tripId, places, hasStart, hasDestination, startLabel, destLabel, defaultEndMode = "free", canEditTrip = false, hasDates = false, onClose, onPreview, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [endMode, setEndMode] = useState<EndMode>(defaultEndMode);
  const [chosen, setChosen] = useState<PlanOption["style"] | null>(null);
  const [applied, setApplied] = useState<{ label: string; snapshot: ReturnType<typeof snapshotPlaces> } | null>(null);
  /** The traveller's choice here about driving after dark; null = their saved answer (no driving after dark by default). */
  const [night, setNight] = useState<boolean | null>(null);

  const load = useCallback(async (mode: EndMode = endMode, nightDriving: boolean | null = night) => {
    setBusy(true); setError(null);
    const r = await post<{ result: BuilderResult; signature: string; duration?: DurationAdvice; engine?: EngineView | null }>(`/api/trips/${tripId}/builder`, { end_mode: mode, engine: true, ...(nightDriving === null ? {} : { night_driving: nightDriving }) });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    const engine = r.data.engine ?? null;
    setData({ result: r.data.result, signature: r.data.signature, duration: r.data.duration ?? null, engine });
    // Point at the plan we recommend and show it on the map straight away.
    const rec = (engine?.recommendedStyle as PlanOption["style"] | undefined) ?? recommendOption(r.data.result.options);
    setChosen((c) => c ?? rec);
    if (rec) onPreview(r.data.result.options.find((o) => o.style === rec) ?? null);
  }, [tripId, endMode, night, onPreview]);

  async function patchPlace(id: string, body: object) {
    setBusy(true);
    const r = await post<object>(`/api/places/${id}`, body, "PATCH");
    if (!r.ok) { setBusy(false); setError(r.error); return; }
    onChanged();
    await load();
  }

  async function apply(option: PlanOption) {
    if (!data) return;
    setBusy(true); setError(null);
    const snapshot = snapshotPlaces(places);
    const r = await post<{ placed: number; movedToIdeas: number }>(`/api/trips/${tripId}/builder/apply`, { style: option.style, end_mode: endMode, signature: data.signature, engine: !!data.engine, ...(night === null ? {} : { night_driving: night }) });
    setBusy(false);
    if (!r.ok) { setError(r.error); if (/changed since/.test(r.error)) void load(); return; }
    setApplied({ label: option.label, snapshot });
    onPreview(null);
    onChanged();
    setData(null);
  }

  async function undo() {
    if (!applied) return;
    setBusy(true);
    const r = await post<object>(`/api/trips/${tripId}/restore`, { places: applied.snapshot, delete_ids: [] });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setApplied(null);
    onChanged();
  }

  async function changeDays(days: number) {
    setBusy(true); setError(null);
    const r = await post<object>(`/api/trips/${tripId}`, { num_days: days }, "PATCH");
    if (!r.ok) { setBusy(false); setError(r.error); return; }
    onChanged();
    await load(); // plan again for the new length
  }

  // Pressing "Plan my trip" shows the result straight away: no second button to press.
  const ready = hasStart && places.length > 0;
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => void load(), 0); // start the request after mount (not inside the effect body)
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, when the panel opens

  const recommended = data ? ((data.engine?.recommendedStyle as PlanOption["style"] | undefined) ?? recommendOption(data.result.options)) : null;
  const groups = data ? distinctPlans(data.result.options, recommended) : [];
  const group = groups.find((g) => g.options.some((o) => o.style === chosen)) ?? groups[0] ?? null;
  const option = group ? group.options.find((o) => o.style === chosen) ?? group.primary : null;
  const ev = data?.engine && option ? data.engine.variants.find((v) => v.style === option.style) ?? null : null;
  const start = startLabel?.trim() || "your start";
  const dest = destLabel?.trim() || "your destination";
  const closeBtn = <button type="button" onClick={() => { onPreview(null); onClose?.(); }} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sky" aria-label="Close Plan my trip"><Glyph name="close" size={20} /></button>;
  const head2 = (sub: string) => (
    <header className="flex items-start justify-between gap-3 px-4 pt-4">
      <div className="min-w-0">
        <h2 id="builder-heading" className="font-display text-lg font-semibold text-pine">Plan my trip</h2>
        <p className="mt-0.5 text-sm text-ink-muted">{sub}</p>
      </div>
      {closeBtn}
    </header>
  );

  if (!hasStart) {
    return (
      <section id="plan-assistant" aria-labelledby="builder-heading" className="rounded-2xl border border-line bg-white pb-4 shadow-sm">
        {head2("Set a starting point to use the planner: we measure real road distances from it. This trip has none, and a starting point can currently only be chosen when a trip is created, so create a new trip to plan this route.")}
      </section>
    );
  }
  if (places.length === 0) {
    return (
      <section id="plan-assistant" aria-labelledby="builder-heading" className="rounded-2xl border border-line bg-white pb-4 shadow-sm">
        {head2("Add places first. Then we fit them into your days using real road times.")}
      </section>
    );
  }

  return (
    <section id="plan-assistant" aria-labelledby="builder-heading" className="rounded-2xl border border-teal/30 bg-white shadow-sm">
      {head2(`Fits your ${places.length} ${places.length === 1 ? "place" : "places"} into ${data?.result.numDays ?? "your"} days using real road times. Nothing changes until you press Use this plan.`)}

      {applied && (
        <p role="status" className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-teal-light px-3 py-2.5 text-sm font-medium text-teal-ink">
          <Glyph name="check" size={16} />Done. The {applied.label} plan is now your itinerary.
          <Button size="sm" variant="secondary" className="ml-auto" loading={busy} onClick={() => void undo()}><Glyph name="uturn" size={14} />Undo</Button>
        </p>
      )}
      {error && <p role="alert" className="mx-4 mt-3 rounded-xl border border-clay/30 bg-clay-light px-3 py-2 text-sm font-medium text-clay-ink">{error}</p>}
      {busy && !data && <p role="status" className="flex items-center gap-2 px-4 pb-5 pt-4 text-sm text-ink-muted"><Spinner size={16} />Measuring real road distances…</p>}

      {data && option && group && (
        <div className="space-y-5 px-4 pb-4 pt-4">
          {/* If the days you chose are more (or fewer) than the places need, that is the first thing to know. */}
          {data.duration && data.duration.verdict !== "unknown" && data.duration.verdict !== "about_right" && <DurationCard a={data.duration} canEdit={canEditTrip} busy={busy} onChange={(d) => void changeDays(d)} />}
          <Verdict r={data.result.reality} routing={data.result.routing} customVisits={places.filter((pl) => pl.visit_minutes != null).length} />
          {data.duration && data.duration.verdict === "about_right" && <DurationCard a={data.duration} canEdit={canEditTrip} busy={busy} onChange={(d) => void changeDays(d)} />}
          {data.result.removeSuggestions.length > 0 && data.result.reality.status === "over" && (
            <div>
              <h3 className="text-sm font-semibold text-pine">Too much for your days. What could go?</h3>
              <ul className="mt-2 space-y-2">
                {data.result.removeSuggestions.map((s) => (
                  <li key={s.placeId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">{s.message}</span>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void patchPlace(s.placeId, { day_number: null })}>Move to Ideas</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* The pace choice only exists when the paces really give different plans. */}
          <div>
            {groups.length === 1 ? (
              <p className="text-sm text-ink-muted"><strong className="text-pine">Your plan.</strong> {data.result.options.length > 1 ? `${joinLabels(group.labels)} all give this same plan for your ${data.result.reality.places} places, so there is nothing to choose. The paces only differ when more places are added than fit comfortably.` : ""}</p>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-pine">Choose a pace</h3>
                <div role="radiogroup" aria-label="Choose a pace" className={`mt-2 grid gap-2 ${groups.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                  {groups.map((g) => {
                    const on = g.options.some((o) => o.style === option.style);
                    const f = paceFacts(g.primary);
                    return (
                      <button key={g.primary.style} type="button" role="radio" aria-checked={on} onClick={() => { setChosen(g.primary.style); onPreview(g.primary); }} className={`relative flex min-h-[4.5rem] flex-col items-start rounded-xl border-2 p-2.5 text-left transition-colors ${on ? "border-teal bg-teal-light/40" : "border-line bg-white hover:border-teal/60"}`}>
                        <span className="text-sm font-semibold text-pine">{joinLabels(g.labels)}</span>
                        <span className="mt-0.5 text-xs text-ink-muted">{g.primary.totals.places} of {data.result.reality.places} places · longest drive {duration(f.longestDriveMin)}</span>
                        {recommended && g.options.some((o) => o.style === recommended) && <span className="mt-1 rounded-full bg-marigold px-2 py-0.5 text-[11px] font-bold text-pine">Recommended</span>}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-ink-muted">{ev ? ev.tradeoff : paceRules(option.style).lines.slice(0, 3).join(" · ")}</p>
              </>
            )}
          </div>

          <div>
            {option.warnings.length > 0 && (
              <ul className="mb-3 space-y-1.5" aria-label="Things to know about this plan">
                {option.warnings.slice(0, 2).map((w, i) => <li key={`${w.code}-${i}`} className={`flex gap-2 rounded-xl border px-3 py-2 text-sm ${sevStyle[w.severity]}`}><Glyph name={w.severity === "info" ? "info" : "warn"} size={14} className="mt-0.5 shrink-0" />{w.message}</li>)}
                {option.warnings.length > 2 && (
                  <li><details><summary className="tm-action flex min-h-11 cursor-pointer items-center text-sm font-semibold">{option.warnings.length - 2} more to know</summary>
                    <ul className="mt-1 space-y-1.5">{option.warnings.slice(2).map((w, i) => <li key={`${w.code}-x${i}`} className={`flex gap-2 rounded-xl border px-3 py-2 text-sm ${sevStyle[w.severity]}`}><Glyph name={w.severity === "info" ? "info" : "warn"} size={14} className="mt-0.5 shrink-0" />{w.message}</li>)}</ul></details></li>
                )}
              </ul>
            )}
            {data.engine && (data.engine.direction || data.engine.notes.length > 0 || data.engine.warnings.length > 0 || (ev && !ev.feasible && ev.needDays)) && (
              <ul className="mb-3 space-y-1.5 text-sm">
                {data.engine.warnings.map((w, i) => <li key={`ew${i}`} className={`flex gap-2 rounded-xl border px-3 py-2 ${sevStyle[w.severity]}`}><Glyph name="warn" size={14} className="mt-0.5 shrink-0" />{w.message}</li>)}
                {data.engine.notes.map((n) => <li key={n} className="rounded-xl bg-sky/60 px-3 py-2 text-ink-muted">{n}</li>)}
                {ev && !ev.feasible && ev.needDays && <li className="rounded-xl bg-sky/60 px-3 py-2 text-ink-muted">Everything fits in this plan with {ev.needDays} days.</li>}
                {data.engine.direction && <li className="rounded-xl bg-sky/60 px-3 py-2 text-ink-muted">{data.engine.direction}</li>}
              </ul>
            )}
            <PlanComfort option={option} hasDates={hasDates} />
            <div className="space-y-3">
              {ev
                ? [
                    ...ev.transitOut.map((t) => ({ day: t.day, el: <TransitDayCard key={`o${t.day}`} t={t} kind="out" /> })),
                    ...option.days.map((d) => ({ day: d.day, el: <Day key={d.day} d={d} halt={ev.halts.find((h) => h.day === d.day) ?? null} /> })),
                    ...ev.transitBack.map((t) => ({ day: t.day, el: <TransitDayCard key={`b${t.day}`} t={t} kind="back" /> })),
                  ].sort((a, b) => a.day - b.day).map((x) => x.el)
                : option.days.map((d) => <Day key={d.day} d={d} />)}
            </div>
            {option.removed.length > 0 && (
              <div className="mt-3">
                <h3 className="text-sm font-semibold text-pine">Left out ({option.removed.length}). They stay in your Ideas.</h3>
                <ul className="mt-2 space-y-2">
                  {option.removed.map((r) => {
                    const add = option.canAddBack.find((a) => a.placeId === r.placeId);
                    return <li key={r.placeId} className="rounded-xl border border-line px-3 py-2.5 text-sm"><strong className="text-pine">{r.name}</strong><p className="text-ink-muted">{r.reason}</p>{add && <p className="mt-1 text-ink-muted">{add.message}</p>}</li>;
                  })}
                </ul>
              </div>
            )}
          </div>

          {data.engine && ev && (
            <div className="space-y-3">
              <WhatIfStepper key={ev.style} v={ev} numDays={data.engine.numDays} canEdit={canEditTrip} busy={busy} onPlan={(d) => void changeDays(d)} />
              <FuelCard km={ev.totals.km} defaultMileage={data.engine.mileage} />
              <PlanLabels e={data.engine} />
            </div>
          )}

          {data.result.clusters.length > 0 && (
            <details className="rounded-xl bg-sky/50 px-3.5">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-pine">Why are some places on the same day?</summary>
              <p className="text-sm text-ink-muted">Places that are close together by road are kept on the same day where possible, so you drive less.</p>
              <ul className="my-2 flex flex-wrap gap-2">
                {data.result.clusters.map((c) => <li key={c.id} className="rounded-full bg-white px-3 py-1.5 text-xs text-pine"><strong>{c.label}</strong> · {c.fromStart.dir} of {start}, {c.fromStart.km} km</li>)}
              </ul>
            </details>
          )}

          <details open={data.result.reality.status !== "fits"} className="rounded-xl border border-line">
            <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-2 px-3.5 text-sm font-semibold text-pine">Fine-tune <span className="text-right text-xs font-normal text-ink-muted">time at each place · where it ends</span></summary>
            <div className="space-y-4 border-t border-line px-3.5 pb-4 pt-3">
              <fieldset>
                <legend className="text-sm font-semibold text-pine">Where does your trip end?</legend>
                <div role="radiogroup" aria-label="Where does your trip end?" className="mt-2 flex flex-wrap gap-2">
                  {([["free", "Anywhere"], ["start", `Back to ${start}`], ...(hasDestination ? [["point", `At ${dest}`]] : [])] as [EndMode, string][]).map(([m, label]) => (
                    <button key={m} type="button" role="radio" aria-checked={endMode === m} onClick={() => { setEndMode(m); void load(m); }} className={`min-h-11 rounded-full border-2 px-4 text-sm font-semibold ${endMode === m ? "border-teal bg-teal-light/50 text-teal-ink" : "border-line text-ink-muted hover:border-teal/60"}`}>{label}</button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-ink-muted">{endMode === "start" ? "We add the drive home to the last day." : endMode === "point" ? "Every plan is built to finish there." : "The trip ends at your last place. No drive home is added."}</p>
              </fieldset>
              {data.engine && (
                <fieldset>
                  <legend className="text-sm font-semibold text-pine">Driving after dark</legend>
                  <div role="radiogroup" aria-label="Driving after dark" className="mt-2 flex flex-wrap gap-2">
                    {([[false, "No (safer)"], [true, "Yes, it's fine"]] as [boolean, string][]).map(([v, label]) => {
                      const on = (night ?? data.engine!.nightDriving) === v;
                      return <button key={label} type="button" role="radio" aria-checked={on} onClick={() => { setNight(v); void load(endMode, v); }} className={`min-h-11 rounded-full border-2 px-4 text-sm font-semibold ${on ? "border-teal bg-teal-light/50 text-teal-ink" : "border-line text-ink-muted hover:border-teal/60"}`}>{label}</button>;
                    })}
                  </div>
                  <p className="mt-1.5 text-xs text-ink-muted">With No, every drive is planned to end by sunset (an hour earlier on hill roads).</p>
                </fieldset>
              )}
              <fieldset>
                <legend className="text-sm font-semibold text-pine">Each place</legend>
                <p className="mt-0.5 text-xs text-ink-muted">How long you will stay changes how many days you need. &ldquo;How much it matters&rdquo; only counts if your days are too full: places are given up from the bottom, and Must do places never are.</p>
                <ul className="mt-2 divide-y divide-line">
                  {places.map((pl) => {
                    const c = data.result.placeCosts.find((x) => x.placeId === pl.id);
                    const usual = Math.round(CATEGORIES[normalizeCategory(pl.category)].hours * 60);
                    const mine = pl.visit_minutes ?? null;
                    const options = [...new Set([30, 45, 60, 90, 120, 180, 240, 360, ...(mine ? [mine] : [])])].sort((x, y) => x - y);
                    return (
                      <li key={pl.id} className="py-3">
                        <p className="truncate text-sm font-semibold text-pine">{pl.name}</p>
                        {c && <p className="text-xs text-ink-muted">{duration(c.totalMin)} including the drive</p>}
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div>
                            <label htmlFor={`prio-${pl.id}`} className="block text-xs font-semibold text-ink-muted">How much it matters</label>
                            <div className="mt-1"><Select id={`prio-${pl.id}`} label="How much it matters" value={pl.priority ?? "normal"} disabled={busy} onChange={(v) => void patchPlace(pl.id, { priority: v })} options={PRIORITIES.map((pr) => ({ value: pr, label: PRIORITY_UI[pr].label }))} className="!min-h-11 !px-2.5 !text-sm" /></div>
                          </div>
                          <div>
                            <label htmlFor={`visit-${pl.id}`} className="block text-xs font-semibold text-ink-muted">Time there</label>
                            <div className="mt-1"><Select id={`visit-${pl.id}`} label="Time there" value={mine === null ? "" : String(mine)} disabled={busy} onChange={(v) => void patchPlace(pl.id, { visit_minutes: v === "" ? null : Number(v) })} options={[{ value: "", label: `Usual · ${short(usual)}` }, ...options.map((m) => ({ value: String(m), label: short(m) }))]} className="!min-h-11 !px-2.5 !text-sm" /></div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            </div>
          </details>

          <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white/95 p-3 pl-4 shadow-lg backdrop-blur">
            <p className="min-w-0 text-sm text-ink-muted"><strong className="text-pine">{option.label}</strong> · {option.totals.places} of {data.result.reality.places} places</p>
            <Button loading={busy} loadingLabel="Applying…" disabled={option.totals.places === 0} onClick={() => void apply(option)}>Use this plan</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function Verdict({ r, routing, customVisits }: { r: BuilderResult["reality"]; routing: string; customVisits: number }) {
  const pct = (n: number) => `${Math.min(100, (n / Math.max(1, r.availableMin, r.neededMin)) * 100)}%`;
  const tone = r.status === "over" ? { bar: "bg-clay", box: "border-clay/40 bg-clay-light/50", icon: "warn" as const, word: "Won't fit" } : r.status === "tight" ? { bar: "bg-marigold", box: "border-marigold/50 bg-marigold-light/50", icon: "info" as const, word: "Tight" } : { bar: "bg-teal", box: "border-teal/40 bg-teal-light/40", icon: "checkCircle" as const, word: "Fits" };
  return (
    <div className={`rounded-xl border p-3.5 ${tone.box}`}>
      <p className="flex items-start gap-2 font-semibold text-pine"><Glyph name={tone.icon} size={18} className="mt-0.5 shrink-0" /><span><span className="sr-only">{tone.word}. </span>{r.headline}</span></p>
      {r.places > 0 && (
        <>
          <div className="mt-2.5" role="img" aria-label={`Needed ${duration(r.neededMin)} of ${duration(r.availableMin)} available`}>
            <div className="relative h-2.5 overflow-hidden rounded-full bg-white"><div className={`h-full ${tone.bar}`} style={{ width: pct(r.neededMin) }} /><div className="absolute inset-y-0 w-0.5 bg-pine" style={{ left: pct(r.availableMin) }} /></div>
          </div>
          <dl className="mt-2.5 grid grid-cols-3 gap-2 text-center">
            {[["Driving", duration(r.driveMin)], ["At places", duration(r.visitMin)], ["Breaks", duration(r.bufferMin)]].map(([k, v]) => <div key={k} className="rounded-lg bg-white/70 px-1 py-1.5"><dd className="whitespace-nowrap text-[13px] font-semibold text-pine sm:text-sm">{v}</dd><dt className="text-[11px] text-ink-muted">{k}</dt></div>)}
          </dl>
          <p className="mt-2 text-xs text-ink-muted">You need {duration(r.neededMin)}; your {r.numDays} days have about {duration(r.availableMin)}. {routing === "estimate" ? "Distances are estimates (road routing is unavailable)." : `${r.driveKm.toLocaleString("en-IN")} km by road at typical speeds, no live traffic.`}</p>
          <p className="mt-1 text-xs text-ink-muted">{customVisits === 0 ? "Time at each place is a typical guess for its kind of place. If you will stay shorter or longer, change it under Fine-tune: it can change the answer." : `Using your own time at ${customVisits} ${customVisits === 1 ? "place" : "places"}; the rest are typical guesses. Change them under Fine-tune.`}</p>
        </>
      )}
    </div>
  );
}

function Day({ d, halt = null }: { d: DayPlan; halt?: NightHalt | null }) {
  const st = intensityStyle[d.intensity];
  return (
    <article className="rounded-xl border border-line p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-pine">Day {d.day}{d.date ? <span className="ml-2 text-sm font-normal text-ink-muted">{formatDate(parseISODate(d.date) ?? new Date(), { weekday: "short", day: "numeric", month: "short" })}</span> : null}</h4>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.chip}`}>{st.label}</span>
      </header>
      <p className="mt-0.5 text-xs text-ink-muted">{duration(d.driveMin)} driving · {duration(d.visitMin)} at the places</p>
      {d.stops.length === 0 ? <p className="mt-2 text-sm text-ink-muted">Nothing planned: a free day.</p> : (
        <ol className="mt-2 divide-y divide-line">
          {d.stops.map((s) => (
            <li key={s.placeId} className="flex gap-3 py-2 text-sm">
              <span className="w-[4.5rem] shrink-0 text-xs font-semibold text-ink-muted">{hhmm(s.arriveMin)}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-pine">{s.name}</p>
                <p className="text-xs text-ink-muted">{duration(s.driveMin)} drive · {s.fromPrev.km} km · {duration(s.visitMin)} there</p>
                <details><summary className="tm-action flex min-h-11 cursor-pointer items-center text-xs font-semibold">Why here?</summary><ul className="mb-1 list-disc space-y-0.5 pl-5 text-xs text-ink-muted">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul></details>
              </div>
            </li>
          ))}
        </ol>
      )}
      {d.returnLeg && <p className="mt-2 text-xs text-ink-muted">Then back to {d.returnLeg.to}: {d.returnLeg.km} km · {duration(d.returnLeg.driveMin)}</p>}
      {d.whyEnds && <p className="mt-2 rounded-lg bg-sky px-3 py-1.5 text-xs text-ink-muted">{d.whyEnds}{d.overnightNear && !halt ? ` Night near ${d.overnightNear}.` : ""}</p>}
      {halt && <HaltLine h={halt} />}
    </article>
  );
}

const VERDICT_TONE: Record<DurationAdvice["verdict"], string> = {
  could_be_shorter: "border-teal/40 bg-teal-light/40",
  about_right: "border-line bg-sky/50",
  tight: "border-marigold/50 bg-marigold-light/50",
  needs_more_days: "border-clay/40 bg-clay-light/50",
  unknown: "border-line bg-sky/50",
};

/** "How many days do these places really need?" It describes and offers; the traveller decides. */
export function DurationCard({ a, canEdit, busy, onChange }: { a: DurationAdvice; canEdit: boolean; busy: boolean; onChange: (days: number) => void }) {
  const shorter = a.paces.filter((p) => p.minDays !== null && p.minDays < a.requestedDays);
  return (
    <div className={`mt-3 rounded-xl border p-3.5 ${VERDICT_TONE[a.verdict]}`}>
      <p className="font-semibold text-pine">{a.headline}</p>
      {a.detail && <p className="mt-1 text-sm text-ink-muted">{a.detail}</p>}
      <details className="mt-2">
      <summary className="tm-action flex min-h-11 cursor-pointer items-center text-sm font-semibold">Days needed at each pace</summary>
      <ul className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Days needed at each pace">
        {a.paces.map((p) => (
          <li key={p.key} className="rounded-xl bg-white/80 px-3 py-2 text-sm">
            <p className="font-semibold text-pine">{p.label}</p>
            <p className="text-ink">{p.minDays === null ? "Doesn't fit" : `${p.minDays} ${p.minDays === 1 ? "day" : "days"}`}{p.minDays !== null && !p.comfortable ? " (only just)" : ""}</p>
            <p className="text-xs text-ink-muted">{p.minDays === null ? p.blurb : `${p.perDay ?? 0} places a day`}</p>
          </li>
        ))}
      </ul>
      </details>
      {a.verdict === "could_be_shorter" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canEdit ? shorter.map((p) => <Button key={p.key} size="sm" variant="secondary" disabled={busy} onClick={() => onChange(p.minDays as number)}>Plan {p.minDays} {p.minDays === 1 ? "day" : "days"} ({p.label.toLowerCase()})</Button>) : <p className="text-xs text-ink-muted">Only the trip owner can change the trip length.</p>}
          <span className="text-xs text-ink-muted">Or keep your {a.requestedDays} days. Nothing changes unless you choose.</span>
        </div>
      )}
      <details className="mt-3">
        <summary className="tm-action min-h-11 cursor-pointer text-xs font-semibold">What this assumes{a.missing.length ? ` and what it could not check (${a.missing.length})` : ""}</summary>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-ink-muted">{[...a.assumptions, ...a.missing].map((t) => <li key={t}>{t}</li>)}</ul>
      </details>
    </div>
  );
}

/** How many places sit on easy days and which days are under pressure, with ways to ease them. Suggestions only: nothing is applied. */
function PlanComfort({ option, hasDates }: { option: PlanOption; hasDates: boolean }) {
  const p = dayPressure(option);
  const total = p.comfortableStops + p.pressuredStops;
  if (total === 0) return null;
  return (
    <div className="mb-3 space-y-2 text-sm">
      <p className="font-semibold text-pine">
        {p.pressuredStops === 0 ? `All ${total} ${total === 1 ? "place fits" : "places fit"} comfortably.` : `${p.comfortableStops} of ${total} ${total === 1 ? "place fits" : "places fit"} comfortably. ${p.pressuredStops} ${p.pressuredStops === 1 ? "is" : "are"} on ${p.days.length === 1 ? "a day" : "days"} under time pressure.`}
      </p>
      {p.days.map((d) => (
        <div key={d.day} className="rounded-xl border border-marigold/40 bg-marigold-light/40 px-3 py-2.5">
          <p className="font-semibold text-pine">{d.message}</p>
          <p className="mt-1 text-xs font-semibold text-ink-muted">Ways to ease it (nothing changes until you choose):</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-ink-muted">{d.ease.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      ))}
      {!hasDates && <p className="text-xs text-ink-muted">This trip has no dates, so opening days and weather weren&apos;t considered.</p>}
    </div>
  );
}
