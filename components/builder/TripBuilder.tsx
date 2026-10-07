"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Glyph, CategoryGlyph } from "@/components/ui/Glyph";
import { normalizeCategory } from "@/lib/categories";
import { snapshotPlaces } from "@/lib/snapshot";
import { PRIORITIES, PRIORITY_LABEL, duration, hhmm, type BuilderResult, type DayPlan, type PlanOption, type Priority, type Warning } from "@/lib/trip-builder";
import type { EndMode } from "@/lib/trip-builder/types";
import type { PlaceWithSeason } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { parseISODate } from "@/lib/dates";

type Props = {
  tripId: string;
  places: PlaceWithSeason[];
  hasStart: boolean;
  hasDestination: boolean;
  /** Show this plan on the map (null = back to the saved plan). */
  onPreview: (option: PlanOption | null) => void;
  onChanged: () => void;
};

type Loaded = { result: BuilderResult; signature: string };
const END_LABEL: Record<EndMode, string> = { free: "Finish anywhere", start: "Return to start", point: "End at destination" };

const intensityStyle: Record<DayPlan["intensity"], { chip: string; bar: string; label: string }> = {
  comfortable: { chip: "bg-teal-light text-teal-ink", bar: "bg-teal", label: "Comfortable" },
  moderate: { chip: "bg-sky text-pine", bar: "bg-[#6aa6c9]", label: "Moderate" },
  heavy: { chip: "bg-marigold-light text-[#7a4a00]", bar: "bg-marigold", label: "Heavy" },
  overloaded: { chip: "bg-clay-light text-clay-ink", bar: "bg-clay", label: "Too much" },
};
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

export function TripBuilder({ tripId, places, hasStart, hasDestination, onPreview, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [endMode, setEndMode] = useState<EndMode>("free");
  const [chosen, setChosen] = useState<PlanOption["style"] | null>(null);
  const [applied, setApplied] = useState<{ label: string; snapshot: ReturnType<typeof snapshotPlaces> } | null>(null);

  const load = useCallback(async (mode: EndMode = endMode) => {
    setBusy(true); setError(null);
    const r = await post<{ result: BuilderResult; signature: string }>(`/api/trips/${tripId}/builder`, { end_mode: mode });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setData({ result: r.data.result, signature: r.data.signature });
    setChosen((c) => c ?? "balanced");
  }, [tripId, endMode]);

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
    const r = await post<{ placed: number; movedToIdeas: number }>(`/api/trips/${tripId}/builder/apply`, { style: option.style, end_mode: endMode, signature: data.signature });
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

  const option = data?.result.options.find((o) => o.style === chosen) ?? null;

  if (!hasStart) {
    return <section className="rounded-3xl border border-line bg-white p-5"><h2 className="font-display text-xl font-semibold text-pine">Trip builder</h2><p className="mt-1 text-sm text-ink-muted">Set a starting point for this trip first. The builder measures real road distances from it.</p></section>;
  }

  return (
    <section aria-labelledby="builder-heading" className="rounded-3xl border border-teal/30 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-5 sm:px-6">
        <div>
          <h2 id="builder-heading" className="font-display text-xl font-semibold text-pine"><Glyph name="sparkles" size={18} className="mr-1.5 inline align-text-bottom text-marigold" />Trip builder</h2>
          <p className="mt-0.5 text-sm text-ink-muted">Will your places fit your days? We measure real roads, time, weather and opening hours — then show you the options.</p>
        </div>
        {!open ? (
          <Button onClick={() => { setOpen(true); void load(); }} disabled={places.length === 0}>{places.length === 0 ? "Add places first" : "Make my trip fit"}</Button>
        ) : (
          <Button variant="secondary" onClick={() => { setOpen(false); onPreview(null); }}>Close</Button>
        )}
      </div>

      {applied && (
        <p role="status" className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-teal-light px-3 py-2 text-sm font-medium text-teal-ink sm:mx-6">
          <Glyph name="check" size={16} />The {applied.label} plan is now your itinerary.
          <button type="button" onClick={() => void undo()} disabled={busy} className="ml-auto min-h-9 font-semibold underline underline-offset-2">Undo</button>
        </p>
      )}
      {error && <p role="alert" className="mx-4 mt-3 rounded-xl border border-clay/30 bg-clay-light px-3 py-2 text-sm font-medium text-clay-ink sm:mx-6">{error}</p>}

      {open && (
        <div className="space-y-6 px-4 pb-6 pt-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Where does the trip end?">
            {(Object.keys(END_LABEL) as EndMode[]).filter((m) => m !== "point" || hasDestination).map((m) => (
              <button key={m} type="button" aria-pressed={endMode === m} onClick={() => { setEndMode(m); void load(m); }} className={`min-h-10 rounded-full border px-4 text-sm font-semibold ${endMode === m ? "border-teal bg-teal text-white" : "border-line bg-white text-pine"}`}>{END_LABEL[m]}</button>
            ))}
          </div>

          {busy && !data && <p role="status" className="text-sm text-ink-muted">Measuring real road distances…</p>}

          {data && (
            <>
              <Reality r={data.result.reality} routing={data.result.routing} />
              {data.result.notes.length > 0 && <ul className="space-y-1 text-sm text-ink-muted">{data.result.notes.map((n) => <li key={n} className="flex gap-2"><Glyph name="info" size={14} className="mt-0.5 shrink-0" />{n}</li>)}</ul>}

              {data.result.removeSuggestions.length > 0 && data.result.reality.status === "over" && (
                <div>
                  <h3 className="text-sm font-semibold text-pine">What should I remove?</h3>
                  <ul className="mt-2 space-y-2">
                    {data.result.removeSuggestions.map((s) => (
                      <li key={s.placeId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                        <span className="min-w-0">{s.message}</span>
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void patchPlace(s.placeId, { day_number: null })}>Move to Ideas</Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <PlaceList places={places} result={data.result} busy={busy} onPriority={(id, p) => void patchPlace(id, { priority: p })} />

              {data.result.clusters.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-pine">Natural groups (close together by road)</h3>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {data.result.clusters.map((c) => (
                      <li key={c.id} className="rounded-full bg-sky px-3 py-1.5 text-xs text-pine"><strong>{c.label}</strong> · {c.fromStart.dir} of {data.result.options[0]?.days[0]?.stops[0]?.fromPrev.fromName ?? "start"}, {c.fromStart.km} km · within {duration(c.spanMin)} of each other</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold text-pine">Choose a plan</h3>
                <ul className="mt-2 grid gap-3 md:grid-cols-3">
                  {data.result.options.map((o) => (
                    <li key={o.style}><OptionCard o={o} total={data.result.reality.places} selected={chosen === o.style} onSelect={() => { setChosen(o.style); onPreview(o); }} /></li>
                  ))}
                </ul>
              </div>

              {option && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-display text-lg font-semibold text-pine">{option.label} plan — day by day</h3>
                    <Button disabled={busy || option.totals.places === 0} onClick={() => void apply(option)}>Use this plan</Button>
                  </div>
                  {option.warnings.length > 0 && (
                    <ul className="space-y-1.5" aria-label="Warnings">
                      {option.warnings.map((w, i) => <li key={`${w.code}-${i}`} className={`flex gap-2 rounded-lg border px-3 py-1.5 text-sm ${sevStyle[w.severity]}`}><Glyph name={w.severity === "info" ? "info" : "warn"} size={14} className="mt-0.5 shrink-0" />{w.message}</li>)}
                    </ul>
                  )}
                  {option.days.map((d) => <Day key={d.day} d={d} />)}
                  {option.removed.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-pine">Left out of this plan ({option.removed.length}) — they go to your Ideas</h4>
                      <ul className="mt-2 space-y-2">
                        {option.removed.map((r) => {
                          const add = option.canAddBack.find((a) => a.placeId === r.placeId);
                          return <li key={r.placeId} className="rounded-xl border border-line px-3 py-2 text-sm"><strong>{r.name}</strong><p className="text-ink-muted">{r.reason}</p>{add && <p className="mt-1 text-ink-muted">{add.message}</p>}</li>;
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Reality({ r, routing }: { r: BuilderResult["reality"]; routing: string }) {
  const pct = (n: number) => `${Math.min(100, (n / Math.max(1, r.availableMin, r.neededMin)) * 100)}%`;
  const tone = r.status === "over" ? "bg-clay" : r.status === "tight" ? "bg-marigold" : "bg-teal";
  return (
    <div>
      <p className="font-display text-lg font-semibold text-pine">{r.headline}</p>
      {r.places > 0 && (
        <>
          <div className="mt-3" role="img" aria-label={`Needed ${duration(r.neededMin)} of ${duration(r.availableMin)} available`}>
            <div className="relative h-4 overflow-hidden rounded-full bg-line"><div className={`h-full ${tone}`} style={{ width: pct(r.neededMin) }} /><div className="absolute inset-y-0 w-0.5 bg-pine" style={{ left: pct(r.availableMin) }} /></div>
            <p className="mt-1 flex justify-between text-xs text-ink-muted"><span>Needed: <strong className="text-pine">{duration(r.neededMin)}</strong></span><span>Realistically available: <strong className="text-pine">{duration(r.availableMin)}</strong></span></p>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {[["Driving", `${duration(r.driveMin)} · ${r.driveKm.toLocaleString("en-IN")} km`], ["At the places", duration(r.visitMin)], ["Parking & breaks", duration(r.bufferMin)], ["Meals & rest", `${duration(r.mealMin)} (not counted)`]].map(([k, v]) => <div key={k} className="rounded-xl bg-sky px-3 py-2"><dt className="text-xs text-ink-muted">{k}</dt><dd className="font-semibold text-pine">{v}</dd></div>)}
          </dl>
          <p className="mt-2 text-xs text-ink-muted">{routing === "estimate" ? "Distances are estimates right now (routing service unavailable)." : "Distances are real road distances. Times assume typical speeds, not live traffic."}</p>
        </>
      )}
    </div>
  );
}

function PlaceList({ places, result, busy, onPriority }: { places: PlaceWithSeason[]; result: BuilderResult; busy: boolean; onPriority: (id: string, p: Priority) => void }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-pine">Your places — how much does each one matter?</h3>
      <ul className="mt-2 grid gap-2 md:grid-cols-2">
        {places.map((p) => {
          const c = result.placeCosts.find((x) => x.placeId === p.id);
          const cat = normalizeCategory(p.category);
          return (
            <li key={p.id} className="rounded-xl border border-line p-3">
              <p className="flex items-center gap-2 font-semibold text-pine"><CategoryGlyph category={cat} size={16} className="text-teal" />{p.name}</p>
              {c && <p className="mt-0.5 text-xs text-ink-muted">{c.fromStart.dir} of the start · {c.fromStart.km} km · {duration(c.fromStart.driveMin)} drive + {duration(c.visitMin)} there = <strong className="text-pine">~{duration(c.totalMin)}</strong></p>}
              <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={`Priority for ${p.name}`}>
                {PRIORITIES.map((pr) => (
                  <button key={pr} type="button" disabled={busy} aria-pressed={(p.priority ?? "normal") === pr} onClick={() => onPriority(p.id, pr)} className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${(p.priority ?? "normal") === pr ? (pr === "must" ? "border-clay bg-clay text-white" : "border-teal bg-teal text-white") : "border-line bg-white text-ink-muted"}`}>{PRIORITY_LABEL[pr]}</button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OptionCard({ o, total, selected, onSelect }: { o: PlanOption; total: number; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={`h-full w-full rounded-2xl border-2 p-4 text-left ${selected ? "border-teal bg-teal-light/40" : "border-line bg-white"}`}>
      <p className="font-display text-lg font-semibold text-pine">{o.label}</p>
      <p className="text-xs text-ink-muted">{o.tagline}</p>
      <p className="mt-2 text-sm"><strong className="text-pine">{o.totals.places} of {total}</strong> places · {Math.round(o.totals.km).toLocaleString("en-IN")} km · {duration(o.totals.driveMin)} driving</p>
      <div className="mt-2 flex gap-1" aria-hidden="true">{o.days.map((d) => <span key={d.day} title={`Day ${d.day}: ${intensityStyle[d.intensity].label}`} className={`h-2 flex-1 rounded-full ${intensityStyle[d.intensity].bar}`} />)}</div>
      <p className="mt-2 text-xs text-ink-muted">{o.feasible ? "All your must-do places fit." : "Your must-do places don't all fit."}{o.removed.length > 0 ? ` ${o.removed.length} left out.` : ""}{o.warnings.some((w) => w.severity === "risk") ? " ⚠ has risks" : ""}</p>
    </button>
  );
}

function Day({ d }: { d: DayPlan }) {
  const st = intensityStyle[d.intensity];
  return (
    <article className="rounded-2xl border border-line p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-display text-base font-semibold text-pine">Day {d.day}{d.date ? <span className="ml-2 text-sm font-normal text-ink-muted">{formatDate(parseISODate(d.date) ?? new Date(), { weekday: "short", day: "numeric", month: "short" })}</span> : null}</h4>
        <p className="flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-full px-2.5 py-1 font-semibold ${st.chip}`}>{st.label}</span><span className="text-ink-muted"><Glyph name="car" size={13} className="mr-1 inline align-text-bottom" />{duration(d.driveMin)} · {Math.round(d.driveKm)} km · {d.stops.length} place{d.stops.length === 1 ? "" : "s"} · {hhmm(d.startMin)}–{hhmm(d.endMin)}</span></p>
      </header>
      {d.stops.length === 0 ? <p className="mt-2 text-sm text-ink-muted">Nothing planned: a free day.</p> : (
        <ol className="mt-3 space-y-3">
          {d.stops.map((s) => (
            <li key={s.placeId} className="text-sm">
              <p className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-xs text-ink-muted">{hhmm(s.arriveMin)}</span><strong className="text-pine">{s.name}</strong><span className="text-xs text-ink-muted">{s.fromPrev.dir} of {s.fromPrev.fromName} · {s.driveKm} km · {duration(s.driveMin)} · stay {duration(s.visitMin)}</span></p>
              <details className="mt-0.5"><summary className="min-h-8 cursor-pointer text-xs font-semibold text-ink-muted underline underline-offset-2">Why here?</summary><ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink-muted">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul></details>
            </li>
          ))}
        </ol>
      )}
      {d.returnLeg && <p className="mt-2 text-xs text-ink-muted">Then back to {d.returnLeg.to}: {d.returnLeg.km} km · {duration(d.returnLeg.driveMin)}</p>}
      {d.whyEnds && <p className="mt-2 rounded-lg bg-sky px-3 py-1.5 text-xs text-ink-muted">{d.whyEnds}{d.overnightNear ? ` Night near ${d.overnightNear}.` : ""}</p>}
    </article>
  );
}
