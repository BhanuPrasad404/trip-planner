"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Glyph, CategoryGlyph } from "@/components/ui/Glyph";
import { PlacePhoto } from "@/components/ui/PlacePhoto";
import { Spinner } from "@/components/ui/Spinner";
import { usePlacePhotos } from "@/lib/client/use-place-photos";
import type { PlacePhoto as Photo } from "@/lib/place-photos";
import type { GlyphName } from "@/lib/glyphs";
import { normalizeCategory } from "@/lib/categories";
import { snapshotPlaces } from "@/lib/snapshot";
import { PRIORITIES, duration, hhmm, type BuilderResult, type DayPlan, type PlanOption, type Priority, type Warning } from "@/lib/trip-builder";
import { PRIORITY_UI, paceFacts, recommendOption } from "@/lib/trip-builder/recommend";
import type { EndMode } from "@/lib/trip-builder/types";
import type { PlaceWithSeason } from "@/lib/types";
import { formatDate } from "@/lib/format";
import type { DurationAdvice } from "@/lib/trip-builder/duration";
import { parseISODate } from "@/lib/dates";

type Props = {
  tripId: string;
  places: PlaceWithSeason[];
  hasStart: boolean;
  hasDestination: boolean;
  /** Names used in the "where does it end?" choices. */
  startLabel?: string | null;
  destLabel?: string | null;
  /** The signed-in person owns the trip (only the owner can change its length). */
  canEditTrip?: boolean;
  /** Show this plan on the map (null = back to the saved plan). */
  onPreview: (option: PlanOption | null) => void;
  onChanged: () => void;
};

type Loaded = { result: BuilderResult; signature: string; duration: DurationAdvice | null };

const intensityStyle: Record<DayPlan["intensity"], { chip: string; bar: string; label: string }> = {
  comfortable: { chip: "bg-teal-light text-teal-ink", bar: "bg-teal", label: "Easy" },
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

export function TripBuilder({ tripId, places, hasStart, hasDestination, startLabel, destLabel, canEditTrip = false, onPreview, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [endMode, setEndMode] = useState<EndMode>("free");
  const [chosen, setChosen] = useState<PlanOption["style"] | null>(null);
  const [applied, setApplied] = useState<{ label: string; snapshot: ReturnType<typeof snapshotPlaces> } | null>(null);
  // Real photos of the places, looked up only once the assistant is open and after the plan is on screen.
  const photoQueries = useMemo(() => (open ? places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).map((p) => ({ key: p.id, name: p.name, lat: p.lat, lng: p.lng })) : []), [open, places]);
  const photos = usePlacePhotos(photoQueries);
  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  const load = useCallback(async (mode: EndMode = endMode) => {
    setBusy(true); setError(null);
    const r = await post<{ result: BuilderResult; signature: string; duration?: DurationAdvice }>(`/api/trips/${tripId}/builder`, { end_mode: mode });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setData({ result: r.data.result, signature: r.data.signature, duration: r.data.duration ?? null });
    // Point at the plan we recommend and show it on the map straight away.
    const rec = recommendOption(r.data.result.options);
    setChosen((c) => c ?? rec);
    if (rec) onPreview(r.data.result.options.find((o) => o.style === rec) ?? null);
  }, [tripId, endMode, onPreview]);

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

  async function changeDays(days: number) {
    setBusy(true); setError(null);
    const r = await post<object>(`/api/trips/${tripId}`, { num_days: days }, "PATCH");
    if (!r.ok) { setBusy(false); setError(r.error); return; }
    onChanged();
    await load(); // plan again for the new length
  }

  const option = data?.result.options.find((o) => o.style === chosen) ?? null;
  const recommended = data ? recommendOption(data.result.options) : null;
  const start = startLabel?.trim() || "your start";
  const dest = destLabel?.trim() || "your destination";

  if (!hasStart) {
    return (
      <section id="plan-assistant" className="scroll-mt-24 rounded-3xl border border-line bg-white p-5">
        <h2 className="font-display text-xl font-semibold text-pine">Plan my trip</h2>
        <p className="mt-1 text-sm text-ink-muted">Set a starting point to use the planner: we measure real road distances from it. This trip has none, and a starting point can currently only be chosen when a trip is created, so create a new trip to plan this route.</p>
      </section>
    );
  }

  return (
    <section id="plan-assistant" aria-labelledby="builder-heading" className="scroll-mt-24 rounded-3xl border border-teal/30 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 px-4 pt-5 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-marigold-light text-[#7a4a00]"><Glyph name="sparkles" size={20} /></span>
          <div className="min-w-0">
            <h2 id="builder-heading" className="font-display text-xl font-semibold text-pine">Plan my trip</h2>
            <p className="mt-0.5 max-w-2xl text-sm text-ink-muted">Tell us what matters. We check your places against real road times and show three realistic ways to fit them into your days, with the reason for every choice.</p>
          </div>
        </div>
        {!open ? (
          <Button onClick={() => { setOpen(true); void load(); }} disabled={places.length === 0}>{places.length === 0 ? "Add places first" : <><Glyph name="sparkles" size={16} />Plan my trip</>}</Button>
        ) : (
          <Button variant="secondary" onClick={() => { setOpen(false); onPreview(null); }}>Close</Button>
        )}
      </div>

      {!open && (
        <ol className="mx-4 mb-5 mt-4 grid gap-2 text-sm sm:mx-6 sm:grid-cols-3">
          {[["1", "Tell us what matters", "Where it ends, and which places you can't miss."], ["2", "See if it fits", "Real driving time against the time your days really have."], ["3", "Pick a plan", "Relaxed, balanced or explorer. Preview it on the map, then use it."]].map(([n, t, d]) => (
            <li key={n} className="flex gap-3 rounded-2xl bg-sky/60 p-3">
              <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white font-mono text-sm font-semibold text-pine">{n}</span>
              <span><strong className="block text-pine">{t}</strong><span className="text-ink-muted">{d}</span></span>
            </li>
          ))}
          <li className="text-xs text-ink-muted sm:col-span-3">Nothing changes in your itinerary until you press <strong>Use this plan</strong>, and you can undo it.</li>
        </ol>
      )}

      {applied && (
        <p role="status" className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-teal-light px-3 py-2.5 text-sm font-medium text-teal-ink sm:mx-6">
          <Glyph name="check" size={16} />Done. The {applied.label} plan is now your itinerary.
          <Button size="sm" variant="secondary" className="ml-auto" loading={busy} onClick={() => void undo()}><Glyph name="uturn" size={14} />Undo</Button>
        </p>
      )}
      {error && <p role="alert" className="mx-4 mt-3 rounded-xl border border-clay/30 bg-clay-light px-3 py-2 text-sm font-medium text-clay-ink sm:mx-6">{error}</p>}

      {open && (
        <div className="space-y-8 px-4 pb-6 pt-5 sm:px-6">
          <Step n={1} title="Where does your trip end?" help="This changes the last day: we may add the drive home.">
            <div role="radiogroup" aria-label="Where does your trip end?" className="grid gap-2.5 sm:grid-cols-3">
              {([
                ["free", "flag", "Anywhere", "The trip ends at your last place. No drive home is added."],
                ["start", "uturn", `Back to ${start}`, "We add the drive home to the last day."],
                ...(hasDestination ? [["point", "pin", `At ${dest}`, "Every plan is built to finish there."]] : []),
              ] as [EndMode, GlyphName, string, string][]).map(([m, icon, title, text]) => (
                <button key={m} type="button" role="radio" aria-checked={endMode === m} onClick={() => { setEndMode(m); void load(m); }} className={`flex min-h-20 items-start gap-3 rounded-2xl border-2 p-3.5 text-left transition-colors ${endMode === m ? "border-teal bg-teal-light/50" : "border-line bg-white hover:border-teal/60"}`}>
                  <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${endMode === m ? "bg-teal text-white" : "bg-sky text-pine"}`}><Glyph name={icon} size={17} /></span>
                  <span className="min-w-0"><strong className="block text-[15px] text-pine">{title}</strong><span className="text-sm text-ink-muted">{text}</span></span>
                </button>
              ))}
            </div>
          </Step>

          {busy && !data && <p role="status" className="flex items-center gap-2 text-sm text-ink-muted"><Spinner size={16} />Measuring real road distances…</p>}

          {data && (
            <>
              <Step n={2} title="How much does each place matter?" help="If your days turn out too full, places are given up in this order. Must do places are never given up.">
                <Legend />
                <PlaceList places={places} photos={photos} result={data.result} busy={busy} onPriority={(id, p) => void patchPlace(id, { priority: p })} />
              </Step>

              <Step n={3} title="Does it fit your days?">
                <Reality r={data.result.reality} routing={data.result.routing} />
                {data.duration && data.duration.verdict !== "unknown" && <DurationCard a={data.duration} canEdit={canEditTrip} busy={busy} onChange={(d) => void changeDays(d)} />}
                {data.result.notes.length > 0 && <ul className="mt-3 space-y-1 text-sm text-ink-muted">{data.result.notes.map((n) => <li key={n} className="flex gap-2"><Glyph name="info" size={14} className="mt-0.5 shrink-0" />{n}</li>)}</ul>}
                {data.result.removeSuggestions.length > 0 && data.result.reality.status === "over" && (
                  <div className="mt-4">
                    <h4 className="text-sm font-semibold text-pine">Too much for your days. What could go?</h4>
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
              </Step>

              <Step n={4} title="Pick a pace" help="Same places, three ways to spread them. Tap one to see it on the map. Each coloured bar is a day: green is easy, red is too much.">
                <ul className="grid gap-3 md:grid-cols-3">
                  {data.result.options.map((o) => (
                    <li key={o.style}><OptionCard o={o} total={data.result.reality.places} recommended={recommended === o.style} selected={chosen === o.style} onSelect={() => { setChosen(o.style); onPreview(o); }} /></li>
                  ))}
                </ul>
                {data.result.clusters.length > 0 && (
                  <details className="mt-4 rounded-2xl bg-sky/50 px-4 py-3">
                    <summary className="min-h-8 cursor-pointer text-sm font-semibold text-pine">Why are some places grouped on the same day?</summary>
                    <p className="mt-2 text-sm text-ink-muted">Places that are close together by road are kept on the same day where possible, so you drive less.</p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {data.result.clusters.map((c) => (
                        <li key={c.id} className="rounded-full bg-white px-3 py-1.5 text-xs text-pine"><strong>{c.label}</strong> · {c.fromStart.dir} of {start}, {c.fromStart.km} km · within {duration(c.spanMin)} of each other</li>
                      ))}
                    </ul>
                  </details>
                )}
              </Step>

              {option && (
                <Step n={5} title={`Your ${option.label} plan, day by day`} help="Tap “Why here?” on any place to see the numbers behind its position.">
                  {option.warnings.length > 0 && (
                    <ul className="mb-3 space-y-1.5" aria-label="Things to know about this plan">
                      {option.warnings.map((w, i) => <li key={`${w.code}-${i}`} className={`flex gap-2 rounded-xl border px-3 py-2 text-sm ${sevStyle[w.severity]}`}><Glyph name={w.severity === "info" ? "info" : "warn"} size={14} className="mt-0.5 shrink-0" />{w.message}</li>)}
                    </ul>
                  )}
                  <div className="space-y-4">
                    {option.days.map((d) => <Day key={d.day} d={d} photos={photos} placeById={placeById} />)}
                  </div>
                  {option.removed.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-sm font-semibold text-pine">Left out of this plan ({option.removed.length}). They stay in your Ideas.</h4>
                      <ul className="mt-2 space-y-2">
                        {option.removed.map((r) => {
                          const add = option.canAddBack.find((a) => a.placeId === r.placeId);
                          return <li key={r.placeId} className="rounded-xl border border-line px-3 py-2.5 text-sm"><strong className="text-pine">{r.name}</strong><p className="text-ink-muted">{r.reason}</p>{add && <p className="mt-1 text-ink-muted">{add.message}</p>}</li>;
                        })}
                      </ul>
                    </div>
                  )}

                  <div className="sticky bottom-3 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white/95 p-3 pl-4 shadow-lg backdrop-blur">
                    <p className="min-w-0 text-sm text-ink-muted"><strong className="text-pine">{option.label} plan</strong> · {paceFacts(option).summary}</p>
                    <Button loading={busy} loadingLabel="Applying…" disabled={option.totals.places === 0} onClick={() => void apply(option)}>Use this plan</Button>
                  </div>
                </Step>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Step({ n, title, help, children }: { n: number; title: string; help?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`}>
      <h3 id={`step-${n}`} className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-pine font-mono text-sm font-semibold text-white">{n}</span>
        <span className="min-w-0">
          <span className="block font-display text-lg font-semibold leading-snug text-pine">{title}</span>
          {help && <span className="mt-0.5 block text-sm font-normal text-ink-muted">{help}</span>}
        </span>
      </h3>
      <div className="mt-3 sm:pl-11">{children}</div>
    </section>
  );
}

function Legend() {
  return (
    <dl className="mb-3 grid gap-2 sm:grid-cols-4">
      {PRIORITIES.map((p) => (
        <div key={p} className="rounded-xl bg-sky/60 px-3 py-2">
          <dt className="text-sm font-semibold text-pine">{PRIORITY_UI[p].label}</dt>
          <dd className="text-xs text-ink-muted">{PRIORITY_UI[p].hint}</dd>
        </div>
      ))}
    </dl>
  );
}

function Reality({ r, routing }: { r: BuilderResult["reality"]; routing: string }) {
  const pct = (n: number) => `${Math.min(100, (n / Math.max(1, r.availableMin, r.neededMin)) * 100)}%`;
  const tone = r.status === "over" ? { bar: "bg-clay", box: "border-clay/40 bg-clay-light/50", icon: "warn" as const, word: "Won't fit" } : r.status === "tight" ? { bar: "bg-marigold", box: "border-marigold/50 bg-marigold-light/50", icon: "info" as const, word: "Tight" } : { bar: "bg-teal", box: "border-teal/30 bg-teal-light/40", icon: "checkCircle" as const, word: "Fits" };
  return (
    <div className={`rounded-2xl border p-4 ${tone.box}`}>
      <p className="flex items-start gap-2.5 font-display text-lg font-semibold text-pine"><Glyph name={tone.icon} size={20} className="mt-0.5 shrink-0" /><span><span className="sr-only">{tone.word}. </span>{r.headline}</span></p>
      {r.places > 0 && (
        <>
          <div className="mt-3" role="img" aria-label={`Needed ${duration(r.neededMin)} of ${duration(r.availableMin)} available`}>
            <div className="relative h-4 overflow-hidden rounded-full bg-white"><div className={`h-full ${tone.bar}`} style={{ width: pct(r.neededMin) }} /><div className="absolute inset-y-0 w-0.5 bg-pine" style={{ left: pct(r.availableMin) }} /></div>
            <p className="mt-1.5 flex justify-between gap-3 text-xs text-ink-muted"><span>Time you need: <strong className="text-pine">{duration(r.neededMin)}</strong></span><span>Time your days really have: <strong className="text-pine">{duration(r.availableMin)}</strong></span></p>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {[["Driving", `${duration(r.driveMin)} · ${r.driveKm.toLocaleString("en-IN")} km`], ["At the places", duration(r.visitMin)], ["Parking & breaks", duration(r.bufferMin)], ["Meals & rest", `${duration(r.mealMin)} (not counted)`]].map(([k, v]) => <div key={k} className="rounded-xl bg-white/80 px-3 py-2"><dt className="text-xs text-ink-muted">{k}</dt><dd className="font-semibold text-pine">{v}</dd></div>)}
          </dl>
          <p className="mt-2.5 text-xs text-ink-muted">{routing === "estimate" ? "Distances are estimates right now (the routing service is unavailable)." : "Distances are real road distances. Times assume typical speeds, not live traffic."}</p>
        </>
      )}
    </div>
  );
}

function PlaceList({ places, photos, result, busy, onPriority }: { places: PlaceWithSeason[]; photos: Record<string, Photo>; result: BuilderResult; busy: boolean; onPriority: (id: string, p: Priority) => void }) {
  return (
    <ul className="grid gap-2.5 md:grid-cols-2">
      {places.map((p) => {
        const c = result.placeCosts.find((x) => x.placeId === p.id);
        const cat = normalizeCategory(p.category);
        const current = p.priority ?? "normal";
        return (
          <li key={p.id} className="flex gap-3 rounded-2xl border border-line p-3">
            <PlacePhoto photo={photos[p.id]} name={p.name} credit className="h-20 w-20" fallback={<CategoryGlyph category={cat} size={26} />} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-pine">{p.name}</p>
              {c && <p className="mt-0.5 text-xs text-ink-muted">{c.fromStart.dir} of the start · {c.fromStart.km} km · {duration(c.fromStart.driveMin)} drive + {duration(c.visitMin)} there = <strong className="text-pine">~{duration(c.totalMin)}</strong></p>}
              <div role="radiogroup" aria-label={`How much ${p.name} matters`} className="mt-2.5 inline-flex max-w-full flex-wrap overflow-hidden rounded-xl border border-line bg-white">
                {PRIORITIES.map((pr, i) => (
                  <button key={pr} type="button" role="radio" aria-checked={current === pr} disabled={busy} title={PRIORITY_UI[pr].hint} onClick={() => onPriority(p.id, pr)}
                    className={`min-h-10 px-3 text-xs font-semibold transition-colors disabled:opacity-60 ${i > 0 ? "border-l border-line" : ""} ${current === pr ? (pr === "must" ? "bg-clay text-white" : "bg-teal text-white") : "text-ink-muted hover:bg-sky"}`}>
                    {PRIORITY_UI[pr].label}
                  </button>
                ))}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function OptionCard({ o, total, recommended, selected, onSelect }: { o: PlanOption; total: number; recommended: boolean; selected: boolean; onSelect: () => void }) {
  const f = paceFacts(o);
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={`relative h-full w-full rounded-2xl border-2 p-4 text-left transition-colors ${selected ? "border-teal bg-teal-light/40" : "border-line bg-white hover:border-teal/60"}`}>
      {recommended && <span className="absolute -top-3 left-3 inline-flex items-center gap-1 rounded-full bg-marigold px-2.5 py-0.5 text-xs font-bold text-pine shadow-sm"><Glyph name="sparkles" size={12} />Recommended</span>}
      <p className="font-display text-lg font-semibold text-pine">{o.label}</p>
      <p className="text-sm text-ink-muted">{o.tagline}</p>
      <p className="mt-3 text-sm"><strong className="text-pine">{o.totals.places} of {total}</strong> places · {Math.round(o.totals.km).toLocaleString("en-IN")} km · {duration(o.totals.driveMin)} driving</p>
      <p className="mt-1 text-sm text-ink-muted">{f.summary}</p>
      <div className="mt-3 flex gap-1" aria-hidden="true">{o.days.map((d) => <span key={d.day} title={`Day ${d.day}: ${intensityStyle[d.intensity].label}`} className={`h-2.5 flex-1 rounded-full ${intensityStyle[d.intensity].bar}`} />)}</div>
      <p className="mt-3 text-sm text-ink-muted">
        {o.feasible ? "All your must-do places fit." : <strong className="text-clay-ink">Your must-do places don&apos;t all fit.</strong>}
        {f.leftOut ? ` ${f.leftOut}` : ""}
        {o.warnings.some((w) => w.severity === "risk") && <strong className="text-clay-ink"> Has risks: see below.</strong>}
      </p>
    </button>
  );
}

function Day({ d, photos, placeById }: { d: DayPlan; photos: Record<string, Photo>; placeById: Map<string, PlaceWithSeason> }) {
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
            <li key={s.placeId} className="flex gap-3 text-sm">
              <PlacePhoto photo={photos[s.placeId]} name={s.name} credit className="h-16 w-16 sm:h-20 sm:w-20" fallback={<CategoryGlyph category={normalizeCategory(placeById.get(s.placeId)?.category ?? null)} size={22} />} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-xs text-ink-muted">{hhmm(s.arriveMin)}</span><strong className="text-pine">{s.name}</strong><span className="text-xs text-ink-muted">{s.fromPrev.dir} of {s.fromPrev.fromName} · {s.driveKm} km · {duration(s.driveMin)} · stay {duration(s.visitMin)}</span></p>
                <details className="mt-0.5"><summary className="min-h-8 cursor-pointer text-xs font-semibold text-ink-muted underline underline-offset-2">Why here?</summary><ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink-muted">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul></details>
              </div>
            </li>
          ))}
        </ol>
      )}
      {d.returnLeg && <p className="mt-2 text-xs text-ink-muted">Then back to {d.returnLeg.to}: {d.returnLeg.km} km · {duration(d.returnLeg.driveMin)}</p>}
      {d.whyEnds && <p className="mt-2 rounded-lg bg-sky px-3 py-1.5 text-xs text-ink-muted">{d.whyEnds}{d.overnightNear ? ` Night near ${d.overnightNear}.` : ""}</p>}
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
    <div className={`mt-4 rounded-2xl border p-4 ${VERDICT_TONE[a.verdict]}`}>
      <p className="font-display text-base font-semibold text-pine">{a.headline}</p>
      {a.detail && <p className="mt-1 text-sm text-ink-muted">{a.detail}</p>}
      <ul className="mt-3 grid gap-2 sm:grid-cols-3" aria-label="Days needed at each pace">
        {a.paces.map((p) => (
          <li key={p.key} className="rounded-xl bg-white/80 px-3 py-2 text-sm">
            <p className="font-semibold text-pine">{p.label}</p>
            <p className="text-ink">{p.minDays === null ? "Doesn't fit" : `${p.minDays} ${p.minDays === 1 ? "day" : "days"}`}{p.minDays !== null && !p.comfortable ? " (only just)" : ""}</p>
            <p className="text-xs text-ink-muted">{p.minDays === null ? p.blurb : `${p.perDay ?? 0} places a day`}</p>
          </li>
        ))}
      </ul>
      {a.verdict === "could_be_shorter" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canEdit ? shorter.map((p) => <Button key={p.key} size="sm" variant="secondary" disabled={busy} onClick={() => onChange(p.minDays as number)}>Plan {p.minDays} {p.minDays === 1 ? "day" : "days"} ({p.label.toLowerCase()})</Button>) : <p className="text-xs text-ink-muted">Only the trip owner can change the trip length.</p>}
          <span className="text-xs text-ink-muted">Or keep your {a.requestedDays} days. Nothing changes unless you choose.</span>
        </div>
      )}
      <details className="mt-3">
        <summary className="min-h-8 cursor-pointer text-xs font-semibold text-ink-muted underline underline-offset-2">What this assumes{a.missing.length ? ` and what it could not check (${a.missing.length})` : ""}</summary>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-ink-muted">{[...a.assumptions, ...a.missing].map((t) => <li key={t}>{t}</li>)}</ul>
      </details>
    </div>
  );
}
