"use client";

// "Your plan" (Phase 4): the engine's answer on one phone-first screen. For a saved trip it plans live and can be changed (must see,
// skip, add back, add a place, more days) and used; for a ready-made example it shows the same screen and offers "Save this trip"
// (sign-up only there). Little on screen at once: the plan switcher, one verdict line, a small map, the days; everything else is folded.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FuelCard, PlanLabels, TransitDayCard, WhatIfStepper } from "@/components/builder/EngineExtras";
import { PlaceSearch, type PickedPlace } from "@/components/PlaceSearch";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { Spinner } from "@/components/ui/Spinner";
import { saveDraft } from "@/lib/client/plan-draft-store";
import type { EngineView } from "@/lib/engine/types";
import { exampleDraft } from "@/lib/result/example-draft";
import type { ExamplePlan } from "@/lib/result/examples";
import { dayPoints, stopNumbers, variantOf, verdict, type ResultData, type ResultPlace } from "@/lib/result/model";
import { snapshotPlaces } from "@/lib/snapshot";
import { duration, type PlannedStop, type PlanOption } from "@/lib/trip-builder";
import type { EndMode } from "@/lib/trip-builder/types";
import type { PlaceWithSeason } from "@/lib/types";
import { DayCard } from "./DayCard";
import { FreeDayCard } from "./FreeDayCard";
import { TripClockBanner } from "./TripClockBanner";
import { tripClock } from "@/lib/result/trip-clock";
import { freeDays } from "@/lib/result/free-days";
import { dayColorVar, type MapDay, type MapPin } from "./map-parts";

const ResultMap = dynamic(() => import("./ResultMap"), { ssr: false, loading: () => <div aria-hidden="true" className="h-44 w-full rounded-2xl bg-sky" /> });

export type TripResultProps = {
  kind: "trip";
  tripId: string;
  tripName: string;
  numDays: number;
  /** First day of the trip (YYYY-MM-DD), or null when the trip has no dates. */
  startDate: string | null;
  canEdit: boolean;
  endMode: EndMode;
  start: { lat: number; lng: number; label: string };
  end: { lat: number; lng: number; label: string } | null;
  places: PlaceWithSeason[];
};
export type ExampleResultProps = { kind: "example"; example: ExamplePlan; signedIn: boolean };

async function call<T>(url: string, body: unknown, method = "POST"): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as T & { error?: string };
    return r.ok ? { ok: true, data: j } : { ok: false, error: j.error ?? "Something went wrong. Please try again." };
  } catch {
    return { ok: false, error: "No connection. Please try again." };
  }
}

export function ResultView(props: TripResultProps | ExampleResultProps) {
  const router = useRouter();
  const isTrip = props.kind === "trip";
  const [data, setData] = useState<ResultData | null>(props.kind === "example" ? props.example.data : null);
  const [signature, setSignature] = useState<string | null>(null);
  const [style, setStyle] = useState<string | null>(props.kind === "example" ? props.example.data.engine.recommendedStyle : null);
  const [skip, setSkip] = useState<string[]>([]);
  const [loading, setLoading] = useState(isTrip);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [sheet, setSheet] = useState<PlannedStop | null>(null);
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState<{ snapshot: ReturnType<typeof snapshotPlaces> } | null>(null);
  const [lines, setLines] = useState<Record<string, [number, number][]>>({});
  const [straight, setStraight] = useState(false);
  // The clock is read after the page is on screen (never during the server render), so the first paint matches.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => { queueMicrotask(() => setNowMs(Date.now())); }, []);

  const numDays = isTrip ? props.numDays : props.example.days;
  const title = isTrip ? props.tripName : props.example.title;
  const places: ResultPlace[] = useMemo(() => (props.kind === "trip" ? props.places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng })) : props.example.data.places), [props]);
  const mustIds = useMemo(() => new Set(props.kind === "trip" ? props.places.filter((p) => p.priority === "must").map((p) => p.id) : []), [props]);

  const load = useCallback(async (nextSkip: string[] = skip) => {
    if (props.kind !== "trip") return;
    setLoading(true); setError(null);
    const r = await call<{ result: { options: PlanOption[] }; signature: string; engine?: EngineView | null }>(`/api/trips/${props.tripId}/builder`, { end_mode: props.endMode, engine: true, skip: nextSkip });
    setLoading(false);
    if (!r.ok) { setError(r.error); return; }
    if (!r.data.engine) { setError("The planner couldn't finish this time. Please try again in a minute."); return; }
    setData({ options: r.data.result.options, engine: r.data.engine, places, start: props.start, end: props.end });
    setSignature(r.data.signature);
    setStyle((s) => (s && r.data.result.options.some((o) => o.style === s) ? s : r.data.engine!.recommendedStyle));
  }, [props, places, skip]);

  const first = useRef(true);
  useEffect(() => {
    if (!first.current || props.kind !== "trip") return;
    first.current = false;
    const t = setTimeout(() => void load(), 0); // after the first paint
    return () => clearTimeout(t);
  }, [load, props.kind]);

  const { option, view } = data && style ? variantOf(data, style) : { option: null, view: null };
  const numbers = useMemo(() => (option ? stopNumbers(option) : new Map<string, number>()), [option]);

  // Road lines for the map: ready-made for an example; for a trip, one road request per day (falls back to straight lines, and says so).
  const points = useMemo(() => (data && style ? dayPoints(data, style) : []), [data, style]);
  useEffect(() => {
    if (props.kind === "example" || !points.length) return; // an example's road lines were fetched when it was built
    let gone = false;
    void (async () => {
      const out: Record<string, [number, number][]> = {};
      let anyStraight = false;
      for (const d of points) {
        const pts = d.points.slice(0, 12);
        const r = await call<{ line: [number, number][]; source: string }>("/api/eta", { points: pts });
        if (r.ok && r.data.source === "osrm" && r.data.line.length > 1) out[d.day] = r.data.line;
        else { out[d.day] = d.points.map((p) => [p.lng, p.lat]); anyStraight = true; }
      }
      if (!gone) { setLines(out); setStraight(anyStraight); }
    })();
    return () => { gone = true; };
  }, [points, props, style]);

  const shownLines = useMemo(() => (props.kind === "example" ? (style ? props.example.lines[style] ?? {} : {}) : lines), [props, style, lines]);
  const mapDays: MapDay[] = useMemo(() => points.map((d) => ({ day: d.day, coords: shownLines[d.day] ?? d.points.map((p) => [p.lng, p.lat] as [number, number]) })), [points, shownLines]);
  const pins: MapPin[] = useMemo(() => {
    if (!option || !data) return [];
    const byId = new Map(data.places.map((p) => [p.id, p]));
    const out: MapPin[] = [{ ...data.start, label: "S", kind: "start" }];
    for (const d of option.days) for (const s of d.stops) { const p = byId.get(s.placeId); if (p) out.push({ lat: p.lat, lng: p.lng, label: String(numbers.get(s.placeId)), kind: "stop" }); }
    for (const h of view?.halts ?? []) if (h.at && !h.atStop) out.push({ ...h.at, label: h.town, kind: "halt" });
    return out;
  }, [option, data, view, numbers]);

  async function patchPlace(id: string, body: object) {
    if (props.kind !== "trip") return;
    setBusy(true);
    const r = await call<object>(`/api/places/${id}`, body, "PATCH");
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    router.refresh();
    await load();
  }
  async function skipPlace(id: string) { const next = [...new Set([...skip, id])]; setSkip(next); setSheet(null); await load(next); }
  async function addBack(id: string) {
    if (skip.includes(id)) { const next = skip.filter((x) => x !== id); setSkip(next); await load(next); return; }
    await patchPlace(id, { priority: "must" });
  }
  async function moreDays(days: number) {
    if (props.kind !== "trip") return;
    setBusy(true);
    const r = await call<object>(`/api/trips/${props.tripId}`, { num_days: days }, "PATCH");
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    router.refresh();
    await load();
  }
  async function startTomorrow(startISO: string) {
    if (props.kind !== "trip") return;
    setBusy(true); setError(null);
    const r = await call<object>(`/api/trips/${props.tripId}`, { start_date: startISO }, "PATCH");
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    router.refresh();
    await load();
  }
  async function addPlace(p: PickedPlace | null) {
    if (!p || props.kind !== "trip") return;
    setBusy(true);
    const r = await call<object>("/api/places/bulk", { trip_id: props.tripId, places: [{ name: p.name, lat: p.lat, lng: p.lng, address: p.address ?? null, source_type: "search" }] });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setAdding(false);
    router.refresh();
    await load();
  }
  async function applyPlan() {
    if (props.kind !== "trip" || !option || !signature) return;
    setBusy(true); setError(null);
    const snapshot = snapshotPlaces(props.places);
    const r = await call<object>(`/api/trips/${props.tripId}/builder/apply`, { style: option.style, end_mode: props.endMode, signature, engine: true, skip });
    setBusy(false);
    if (!r.ok) { setError(r.error); if (/changed since/.test(r.error)) void load(); return; }
    setDone({ snapshot });
    router.refresh();
  }
  async function undo() {
    if (props.kind !== "trip" || !done) return;
    setBusy(true);
    const r = await call<object>(`/api/trips/${props.tripId}/restore`, { places: done.snapshot, delete_ids: [] });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setDone(null);
    router.refresh();
  }
  function saveExample() {
    if (props.kind !== "example") return;
    saveDraft(exampleDraft(props.example));
    const next = "/plan?resume=1";
    router.push(props.signedIn ? next : `/signup?next=${encodeURIComponent(next)}`);
  }

  const back = isTrip ? `/trips/${props.tripId}/plan` : "/plan";
  const v = option ? verdict(option, view, numDays) : null;
  // Only a saved trip has dates; today's day is looked up in the chosen plan so the banner can say when it starts and ends.
  const startDate = props.kind === "trip" ? props.startDate : null;
  const clock = (() => {
    if (nowMs === null || !option) return null;
    const first = tripClock({ startDateISO: startDate, numDays, nowMs });
    const w = first.todayDay ? option.days.find((d) => d.day === first.todayDay && d.stops.length > 0) : null;
    return tripClock({ startDateISO: startDate, numDays, nowMs, todayWindow: w ? { startMin: w.startMin, endMin: w.endMin } : null });
  })();
  const groups = data ? data.options.filter((o) => !data.engine.sameAs[data.engine.variants.find((x) => x.style === o.style)?.id ?? "relaxed"]) : [];
  const sameNote = data ? Object.entries(data.engine.sameAs).map(([a, b]) => `${data.engine.variants.find((x) => x.id === a)?.label} gives the same plan as ${data.engine.variants.find((x) => x.id === b)?.label}.`) : [];
  const leftOut = option ? [...option.removed.map((r) => ({ id: r.placeId, name: r.name, reason: r.reason })), ...skip.map((id) => ({ id, name: places.find((p) => p.id === id)?.name ?? "A place", reason: "You chose to skip it." }))] : [];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-32 pt-3">
      <header className="flex items-start gap-2">
        <Link href={back} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-pine hover:bg-sky" aria-label={isTrip ? "Back to the trip" : "Back"}><Glyph name="arrow" size={20} className="rotate-180" /></Link>
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">{isTrip ? "Your plan" : "Example plan"}</p>
          <h1 className="font-display text-xl font-semibold leading-tight text-pine">{title}</h1>
          <p className="text-sm text-ink-muted">{numDays} {numDays === 1 ? "day" : "days"}{data ? ` · from ${data.start.label}` : ""}</p>
        </div>
      </header>

      {!isTrip && <p className="mt-3 rounded-xl bg-sky px-3.5 py-2.5 text-sm text-ink-muted">A real plan made with live road data on {props.example.built}. Save it to change places, dates and days.</p>}
      {error && <p role="alert" className="mt-3 rounded-xl border border-clay/40 bg-clay-light px-3.5 py-2.5 text-sm font-medium text-clay-ink">{error}</p>}

      {loading && !data && (
        <div role="status" className="mt-6 space-y-3 rounded-2xl border border-line bg-white p-5">
          <p className="flex items-center gap-2 font-semibold text-pine"><Spinner size={18} />Planning your trip…</p>
          <p className="text-sm text-ink-muted">We&apos;re measuring real roads, checking hill heights and finding towns for the nights. This takes 5 to 20 seconds.</p>
        </div>
      )}

      {data && option && v && (
        <div className={`mt-4 space-y-4 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          {loading && <p role="status" className="flex items-center gap-2 text-sm text-ink-muted"><Spinner size={14} />Updating the plan…</p>}

          {clock && <TripClockBanner clock={clock} canEdit={isTrip && props.canEdit} busy={busy || loading} onStartTomorrow={(iso) => void startTomorrow(iso)} />}

          {/* The three plans. Identical ones are shown once, with a note. */}
          <div>
            <div role="radiogroup" aria-label="Choose a plan" className={`grid gap-2 ${groups.length >= 3 ? "grid-cols-3" : groups.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
              {groups.map((o) => {
                const on = o.style === option.style;
                const rec = o.style === data.engine.recommendedStyle;
                return (
                  <button key={o.style} type="button" role="radio" aria-checked={on} onClick={() => setStyle(o.style)}
                    className={`flex min-h-16 min-w-0 flex-col items-start justify-center rounded-xl border-2 px-2.5 py-2 text-left ${on ? "border-teal bg-teal-light" : "border-line bg-white"}`}>
                    <span className="flex items-center gap-1 text-sm font-semibold text-pine">{on && <Glyph name="check" size={14} />}{o.label}</span>
                    <span className="text-xs text-ink-muted">{o.totals.places} of {places.length - skip.length}</span>
                    {rec && <span className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-teal-ink">Best fit</span>}
                  </button>
                );
              })}
            </div>
            {sameNote.length > 0 && <p className="mt-1.5 text-xs text-ink-muted">{sameNote.join(" ")}</p>}
            <button type="button" onClick={() => setCompare((c) => !c)} aria-expanded={compare} className="tm-action mt-1 min-h-11 text-sm font-semibold">{compare ? "Hide the comparison" : "Compare the plans"}</button>
            {compare && <ComparePlans data={data} total={places.length - skip.length} />}
          </div>

          {/* One verdict line: an icon AND words, never colour alone. */}
          <div className={`flex items-start gap-2 rounded-xl border px-3.5 py-3 ${v.tone === "ok" ? "border-teal/40 bg-teal-light" : v.tone === "warn" ? "border-marigold/50 bg-marigold-light" : "border-clay/40 bg-clay-light"}`}>
            <Glyph name={v.tone === "ok" ? "checkCircle" : "warn"} size={20} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-pine">{v.text}{v.needDays ? ` · fits in ${v.needDays} days` : ""}</p>
              {view?.tradeoff && <p className="text-sm text-ink-muted">{duration(view.totals.driveMin)} driving in all · {view.totals.km.toLocaleString("en-IN")} km</p>}
            </div>
          </div>
          {v.needDays && isTrip && props.canEdit && clock?.state !== "after" && <Button variant="secondary" className="w-full" disabled={busy || loading} onClick={() => void moreDays(v.needDays!)}>Use {v.needDays} days</Button>}

          {/* Map: a small strip; tap for full screen. */}
          <div>
            <button type="button" onClick={() => setMapOpen(true)} className="block w-full text-left" aria-label="Open the map full screen">
              <ResultMap days={mapDays} pins={pins} interactive={false} />
            </button>
            <MapKey days={mapDays.map((d) => d.day)} straight={straight} />
          </div>

          {/* The days, drive days included, in order. */}
          <section aria-label="Day by day" className="space-y-3">
            {[
              ...(view?.transitOut ?? []).map((t) => ({ day: t.day, el: <TransitDayCard key={`o${t.day}`} t={t} kind="out" /> })),
              ...option.days.map((d) => ({ day: d.day, el: <DayCard key={d.day} d={d} numbers={numbers} halt={view?.halts.find((h) => h.day === d.day) ?? null} mustIds={mustIds} onStop={isTrip ? setSheet : undefined} /> })),
              ...(view?.transitBack ?? []).map((t) => ({ day: t.day, el: <TransitDayCard key={`b${t.day}`} t={t} kind="back" /> })),
              ...freeDays([...(view?.transitOut ?? []).map((t) => t.day), ...option.days.map((d) => d.day), ...(view?.transitBack ?? []).map((t) => t.day)], view?.totals.days ?? numDays).map((f) => ({ day: f.day, el: <FreeDayCard key={`f${f.day}`} f={f} /> })),
            ].sort((a, b) => a.day - b.day).map((x) => (clock && x.day <= clock.doneDays
              ? <div key={`done${x.day}`} className="opacity-60"><p className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">Day {x.day} · done</p>{x.el}</div>
              : x.el))}
          </section>

          {leftOut.length > 0 && (
            <section aria-labelledby="left-out-h" className="rounded-2xl border border-line bg-white p-4">
              <h2 id="left-out-h" className="font-display text-base font-semibold text-pine">Left out ({leftOut.length})</h2>
              <ul className="mt-2 divide-y divide-line">
                {leftOut.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1"><p className="font-semibold text-pine">{r.name}</p><p className="text-sm text-ink-muted">{r.reason}</p></div>
                    {isTrip && <Button size="sm" variant="secondary" disabled={busy || loading} onClick={() => void addBack(r.id)}>Add back</Button>}
                  </li>
                ))}
              </ul>
              {isTrip && <p className="mt-1 text-xs text-ink-muted">Add back marks it a must-see and plans again.</p>}
            </section>
          )}

          {isTrip && (adding ? (
            <div className="rounded-2xl border border-line bg-white p-4">
              <PlaceSearch label="Add a place" value={null} onChange={(p) => void addPlace(p)} near={data.start} placeholder="e.g. Kondapalli Fort" hint="Pick a place: we add it to this trip and plan again." />
              <Button variant="ghost" className="mt-2" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          ) : (
            <Button variant="secondary" className="w-full" disabled={busy || loading} onClick={() => setAdding(true)}><Glyph name="search" size={16} />Add a place</Button>
          ))}

          <details className="rounded-2xl border border-line bg-white">
            <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm font-semibold text-pine">What if I had more or fewer days?</summary>
            <div className="border-t border-line p-3">{view && <WhatIfStepper key={`${option.style}:${numDays}`} v={view} numDays={numDays} canEdit={isTrip && props.canEdit} busy={busy || loading} onPlan={(d) => void moreDays(d)} />}</div>
          </details>
          <details className="rounded-2xl border border-line bg-white">
            <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm font-semibold text-pine">Fuel and tolls</summary>
            <div className="space-y-2 border-t border-line p-3">
              {view && <FuelCard km={view.totals.km} defaultMileage={data.engine.mileage} />}
              <p className="px-1 text-sm text-ink-muted">{data.engine.labels.tolls}</p>
            </div>
          </details>
          <PlanLabels e={data.engine} />
        </div>
      )}

      {/* Sticky action. */}
      {data && option && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            {isTrip ? (
              done ? <p role="status" className="flex-1 text-sm font-semibold text-teal-ink">Saved to your trip.</p>
                : <Button className="min-h-12 flex-1" loading={busy} loadingLabel="Saving…" disabled={loading || option.totals.places === 0} onClick={() => void applyPlan()}>Use the {option.label} plan</Button>
            ) : (
              <Button className="min-h-12 flex-1" onClick={saveExample}>{props.signedIn ? "Save this trip" : "Sign up and save this trip"}</Button>
            )}
          </div>
        </div>
      )}

      {done && isTrip && <DonePanel tripId={props.tripId} busy={busy} onUndo={() => void undo()} />}
      {sheet && isTrip && <StopSheet stop={sheet} must={mustIds.has(sheet.placeId)} place={places.find((p) => p.id === sheet.placeId) ?? null} busy={busy} onClose={() => setSheet(null)} onMust={() => { const id = sheet.placeId; setSheet(null); void patchPlace(id, { priority: "must" }); }} onSkip={() => void skipPlace(sheet.placeId)} />}
      {mapOpen && (
        <div role="dialog" aria-modal="true" aria-label="Map of the plan" className="fixed inset-0 z-50 flex flex-col bg-[var(--background)]">
          <div className="flex items-center justify-between px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <p className="font-semibold text-pine">Map</p>
            <button type="button" onClick={() => setMapOpen(false)} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line px-4 text-sm font-semibold text-pine"><Glyph name="close" size={16} />Close</button>
          </div>
          <div className="min-h-0 flex-1 px-2"><ResultMap days={mapDays} pins={pins} interactive className="h-full w-full overflow-hidden rounded-2xl" /></div>
          <div className="px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"><MapKey days={mapDays.map((d) => d.day)} straight={straight} /></div>
        </div>
      )}
    </div>
  );
}

export function MapKey({ days, straight }: { days: number[]; straight: boolean }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
      {days.map((d) => <span key={d} className="inline-flex items-center gap-1"><span aria-hidden="true" className="h-1 w-4 rounded-full" style={{ background: `var(${dayColorVar(d)})` }} />Day {d}</span>)}
      <span>S = start · numbers = stops · ⌂ = night</span>
      {straight && <span>Some lines are straight: the road wasn&apos;t found.</span>}
    </div>
  );
}

export function ComparePlans({ data, total }: { data: ResultData; total: number }) {
  return (
    <table className="mt-2 w-full table-fixed text-left text-sm">
      <caption className="sr-only">The three plans side by side</caption>
      <thead><tr className="text-xs text-ink-muted"><th scope="col" className="w-[34%] py-1 font-semibold"><span className="sr-only">Plan</span></th>{data.engine.variants.map((v) => <th key={v.id} scope="col" className="py-1 font-semibold">{v.label}</th>)}</tr></thead>
      <tbody className="divide-y divide-line text-ink">
        <tr><th scope="row" className="py-1.5 font-normal text-ink-muted">Places</th>{data.engine.variants.map((v) => <td key={v.id}>{v.totals.places} of {total}</td>)}</tr>
        <tr><th scope="row" className="py-1.5 font-normal text-ink-muted">Days</th>{data.engine.variants.map((v) => <td key={v.id}>{v.totals.days}</td>)}</tr>
        <tr><th scope="row" className="py-1.5 font-normal text-ink-muted">Driving</th>{data.engine.variants.map((v) => <td key={v.id}>{duration(v.totals.driveMin)}</td>)}</tr>
        <tr><th scope="row" className="py-1.5 font-normal text-ink-muted">Longest day</th>{data.engine.variants.map((v) => { const o = data.options.find((x) => x.style === v.style); const m = Math.max(0, ...(o?.days.map((d) => d.driveMin) ?? []), ...v.transitOut.map((t) => t.driveMin), ...v.transitBack.map((t) => t.driveMin)); return <td key={v.id}>{duration(m)}</td>; })}</tr>
        <tr><th scope="row" className="py-1.5 font-normal text-ink-muted">Fits</th>{data.engine.variants.map((v) => <td key={v.id}>{!v.feasible ? "No" : v.totals.places >= total ? "Yes" : "Some left out"}</td>)}</tr>
      </tbody>
    </table>
  );
}

export function StopSheet({ stop, must, place, busy, onClose, onMust, onSkip }: { stop: PlannedStop; must: boolean; place: ResultPlace | null; busy: boolean; onClose: () => void; onMust: () => void; onSkip: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--tm-scrim)] sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="stop-sheet-h" onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-3xl border border-line bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="stop-sheet-h" className="font-display text-lg font-semibold text-pine">{stop.name}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sky"><Glyph name="close" size={18} /></button>
        </div>
        {stop.reasons.length > 0 && (
          <details className="mt-1"><summary className="min-h-10 cursor-pointer text-sm font-semibold text-teal-ink">Why here?</summary><ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-muted">{stop.reasons.map((r) => <li key={r}>{r}</li>)}</ul></details>
        )}
        <div className="mt-3 grid gap-2">
          <Button variant="secondary" className="min-h-12 justify-start" disabled={busy || must} onClick={onMust}><Glyph name="star" size={16} />{must ? "Already a must-see" : "Must see (never left out)"}</Button>
          <Button variant="secondary" className="min-h-12 justify-start" disabled={busy} onClick={onSkip}><Glyph name="skip" size={16} />Skip this place</Button>
          {place && <a href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold text-pine"><Glyph name="external" size={16} />Open in Maps<span className="sr-only"> (opens in a new tab)</span></a>}
        </div>
      </div>
    </div>
  );
}

export function DonePanel({ tripId, busy, onUndo }: { tripId: string; busy: boolean; onUndo: () => void }) {
  const links: [string, string, Parameters<typeof Glyph>[0]["name"]][] = [["Plan", "plan", "calendar"], ["Live", "live", "navigate"], ["Map", "map", "pin"], ["Weather", "weather", "cloudSun"]];
  return (
    <section aria-labelledby="done-h" className="mx-auto mt-4 w-full max-w-2xl px-4">
      <div className="rounded-2xl border border-teal/40 bg-teal-light p-4">
        <h2 id="done-h" className="flex items-center gap-2 font-display text-lg font-semibold text-pine"><Glyph name="checkCircle" size={20} />Your trip is ready</h2>
        <p className="mt-1 text-sm text-ink-muted">The places are on their days. Left-out places wait in Ideas.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {links.map(([label, sub, icon]) => <Link key={sub} href={`/trips/${tripId}/${sub}`} className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-line bg-white text-base font-semibold text-pine"><Glyph name={icon} size={18} />{label}</Link>)}
        </div>
        <button type="button" onClick={onUndo} disabled={busy} className="tm-action mt-2 min-h-11 text-sm font-semibold">Undo</button>
      </div>
    </section>
  );
}
