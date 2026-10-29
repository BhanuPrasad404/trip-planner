"use client";
// The ONE opening-hours view for every screen (Search, Explore, "Plan it for me", "On your way", Trip Check). It asks the shared answer
// (/api/places/hours) and shows it with where it came from. For a town, a city or an area it says plainly that there is no single opening
// time, then offers the places in and around it with their own hours (/api/places/around), filterable by kind and date. Adding one of
// them never removes the traveller's destination: the screen's own onAdd decides what "add" means there.
import { useEffect, useMemo, useState } from "react";
import type { AroundAnswer, AroundItem, HoursAnswer } from "@/lib/place-intel/hours-answer";
import { hoursBadge, nextStep, sourceLine, type HoursTone } from "@/lib/place-intel/hours-labels";
import { exploreCategoryLabel, type ExploreCategoryId } from "@/lib/explore/categories";

/** What a screen knows about the place. Only name and position are required; every other fact makes the answer surer. */
export type PlaceRef = {
  name: string; lat: number; lng: number;
  kind?: string | null; category?: ExploreCategoryId | null; wd?: string | null; osm?: string | null; wdType?: string | null; osmType?: string | null;
  pop?: number | null; state?: string | null;
};

const TONE: Record<HoursTone, string> = {
  good: "bg-teal-light text-teal-ink border-teal/40",
  warn: "bg-marigold-light text-marigold-ink border-marigold/50",
  bad: "bg-clay-light text-clay-ink border-clay/40",
  plain: "bg-sky text-ink-muted border-line",
};

const OSM_ID = /^(node|way|relation)\/\d{1,15}$/;
/** A place as the map catalogue / Explore holds it: its kind, and its OpenStreetMap or Wikidata id when it has one. */
export const exploreItemRef = (i: { id: string; name: string; lat: number; lng: number; category?: ExploreCategoryId | null; wikidata?: string | null }): PlaceRef => {
  const raw = i.id.replace(/^osm:/, "");
  return { name: i.name, lat: i.lat, lng: i.lng, category: i.category ?? null, osm: OSM_ID.test(raw) ? raw : null, wd: i.wikidata ?? (/^wd:(Q\d+)$/.exec(i.id)?.[1] ?? null), kind: i.category ? null : "sight" };
};

export function placeParams(p: PlaceRef, date?: string | null): URLSearchParams {
  const q = new URLSearchParams({ name: p.name, lat: String(p.lat), lng: String(p.lng) });
  const add = (k: string, v: string | number | null | undefined) => { if (v !== null && v !== undefined && v !== "") q.set(k, String(v)); };
  add("date", date); add("kind", p.kind); add("category", p.category); add("wd", p.wd); add("osm", p.osm); add("wdType", p.wdType); add("osmType", p.osmType); add("pop", p.pop); add("state", p.state);
  return q;
}

export function HoursBadge({ answer }: { answer: Pick<HoursAnswer, "status" | "source"> }) {
  const b = hoursBadge(answer);
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE[b.tone]}`}>{b.label}</span>;
}

/** One answer, in full: the day, the source, closed days, notes, other sources that disagree, the caution, the place's own page. */
export function HoursDetails({ answer, onAddHours }: { answer: HoursAnswer; onAddHours?: () => void }) {
  const src = sourceLine(answer);
  const next = nextStep(answer, !!onAddHours);
  return (
    <div className="space-y-2 text-sm text-ink">
      <div className="flex flex-wrap items-center gap-2"><HoursBadge answer={answer} /></div>
      <p>{answer.message}</p>
      {answer.schedule && answer.status !== "known" && <p className="break-words text-ink-muted">As written: <span className="font-mono text-xs">{answer.schedule}</span></p>}
      {answer.serviceTimes && <p className="break-words text-ink-muted">Service (darshan / prayer) times as mapped: <span className="font-mono text-xs">{answer.serviceTimes}</span></p>}
      {answer.exceptions.filter((e) => !e.startsWith("Service (")).length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-ink-muted">{answer.exceptions.filter((e) => !e.startsWith("Service (")).map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      {answer.conflicts.length > 0 && (
        <div className="rounded-lg border border-line bg-sky p-2">
          <p className="font-semibold text-ink">What other sources say</p>
          <ul className="mt-1 space-y-1">{answer.conflicts.map((c, i) => <li key={i} className="break-words text-ink-muted"><span className="font-mono text-xs">{c.schedule}</span> · {sourceLine({ source: c.source, status: "unverified" })}</li>)}</ul>
        </div>
      )}
      {src && <p className="text-xs text-ink-muted">{src}</p>}
      {answer.access && <p className="text-xs text-ink-muted">{answer.access}</p>}
      <div className="flex flex-wrap gap-2">
        {answer.officialLink && <a className="tm-action min-h-11" href={answer.officialLink.url} target="_blank" rel="noopener noreferrer nofollow">{answer.officialLink.label}</a>}
        {onAddHours && answer.status !== "known" && answer.status !== "not_applicable" && <button type="button" className="tm-action min-h-11" onClick={onAddHours}>Add the hours you know</button>}
      </div>
      {next && !answer.officialLink && !onAddHours && <p className="text-xs text-ink-muted">{next}</p>}
    </div>
  );
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "We couldn't load this right now.");
  return body as T;
}

type Props = {
  place: PlaceRef;
  /** The visit date (YYYY-MM-DD, India time). Without one, today; the traveller can change it here. */
  date?: string | null;
  /** "Add to my trip" for one of the places around a town. Without it, no add button is shown. */
  onAdd?: (item: AroundItem) => void;
  /** Labels of places already on the trip, so "Add" becomes "On your trip". */
  added?: (item: AroundItem) => boolean;
  /** Opens the screen's own way to type hours (Trip Check). */
  onAddHours?: () => void;
  /** A trip stop's id: its own saved hours (typed or confirmed by a member) are used first. */
  stopId?: string;
};

export function PlaceHours({ place, date: dateIn, onAdd, added, onAddHours, stopId }: Props) {
  // The date the traveller picked here, for the date the screen gave (a new date from the screen starts over).
  const [picked, setPicked] = useState<{ for: string | null; date: string | null } | null>(null);
  const date = picked && picked.for === (dateIn ?? null) ? picked.date : dateIn ?? null;
  // Results are kept with the request they answer, so a new request never shows the old place's answer (nothing is cleared by hand).
  const [res, setRes] = useState<{ key: string; answer?: HoursAnswer; error?: string; around?: AroundAnswer | null; aroundError?: string }>({ key: "" });
  const key = placeParams(place, date).toString();
  const hoursKey = stopId ? `${key}&stop=${encodeURIComponent(stopId)}` : key;

  useEffect(() => {
    const ctl = new AbortController();
    const set = (v: Omit<typeof res, "key">) => setRes((r) => (r.key === hoursKey ? { ...r, ...v } : { key: hoursKey, ...v }));
    getJson<{ answer: HoursAnswer }>(`/api/places/hours?${hoursKey}`, ctl.signal)
      .then((r) => {
        set({ answer: r.answer });
        // A town or an area: the places in and around it. A sight without usable hours: other places near it whose hours are known.
        if (r.answer.status !== "known") {
          return getJson<{ around: AroundAnswer | null }>(`/api/places/around?${key}`, ctl.signal).then((a) => set({ around: a.around })).catch((e: Error) => { if (e.name !== "AbortError") set({ aroundError: e.message }); });
        }
      })
      .catch((e: Error) => { if (e.name !== "AbortError") set({ error: e.message }); });
    return () => ctl.abort();
  }, [key, hoursKey]);

  const cur = res.key === hoursKey ? res : null;
  if (cur?.error) return <p role="status" className="text-sm text-ink-muted">Opening hours: {cur.error}</p>;
  if (!cur?.answer) return <p role="status" aria-live="polite" className="text-sm text-ink-muted">Looking up opening hours…</p>;
  const answer = cur.answer;
  return <PlaceHoursView place={place} answer={answer} around={cur.around ?? null} aroundLoading={answer.status !== "known" && cur.around === undefined && !cur.aroundError} aroundError={cur.aroundError ?? null}
    date={date ?? answer.date} onDate={(d) => setPicked({ for: dateIn ?? null, date: d })} onAdd={onAdd} added={added} onAddHours={onAddHours} />;
}

type ViewProps = Pick<Props, "onAdd" | "added" | "onAddHours"> & {
  place: Pick<PlaceRef, "name">; answer: HoursAnswer; around: AroundAnswer | null; aroundLoading: boolean; aroundError: string | null;
  date: string; onDate: (d: string | null) => void;
};

/** The answer as data: what every screen shows (the static render and the phone-width check use this directly). */
export function PlaceHoursView({ place, answer, around, aroundLoading, aroundError, date, onDate, onAdd, added, onAddHours }: ViewProps) {
  const [kind, setKind] = useState<ExploreCategoryId | "all">("all");
  const town = answer.status === "not_applicable";
  const items = useMemo(() => {
    const all = (around?.items ?? []).filter((i) => i.name !== place.name || !town);
    if (town) return all.filter((i) => kind === "all" || i.category === kind);
    return all.filter((i) => i.hours.status === "known").slice(0, 4);
  }, [around, kind, town, place.name]);
  const kinds = useMemo(() => [...new Set((around?.items ?? []).map((i) => i.category))], [around]);

  return (
    <section className="min-w-0 space-y-3" aria-label={`Opening hours: ${place.name}`}>
      <HoursDetails answer={answer} onAddHours={town ? undefined : onAddHours} />
      <label className="flex flex-wrap items-center gap-2 text-sm text-ink">
        <span>Visit date</span>
        <input type="date" className="min-h-11 max-w-full rounded-lg border border-line bg-background px-2 text-ink" value={date} onChange={(e) => onDate(e.target.value || null)} />
      </label>
      {(town || items.length > 0 || aroundLoading) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">{town ? `Places to visit in and around ${place.name}` : "Nearby places with known hours"}</h3>
          {town && kinds.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Show only">
              {(["all", ...kinds] as const).map((k) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
                  className={`min-h-11 rounded-full border px-3 text-sm ${kind === k ? "border-teal bg-teal-light text-teal-ink font-semibold" : "border-line bg-background text-ink"}`}>
                  {k === "all" ? "All" : exploreCategoryLabel(k)}
                </button>
              ))}
            </div>
          )}
          {aroundError && <p className="text-sm text-ink-muted">We can&apos;t suggest places right now: {aroundError}</p>}
          {aroundLoading && <p role="status" aria-live="polite" className="text-sm text-ink-muted">Finding places…</p>}
          {town && !aroundLoading && !aroundError && !around && <p className="text-sm text-ink-muted">We can&apos;t suggest places right now: our place catalogue isn&apos;t available.</p>}
          {town && around && items.length === 0 && <p className="text-sm text-ink-muted">Our place catalogue has no places within reach to suggest.</p>}
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.key} className="min-w-0 rounded-xl border border-line bg-background p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-ink">{i.name}</p>
                    <p className="text-xs text-ink-muted">{exploreCategoryLabel(i.category)}{i.role.role === "complex" ? ` · ${i.parts} parts` : ""} · about {Math.round(i.km)} km</p>
                  </div>
                  <HoursBadge answer={i.hours} />
                </div>
                {i.hours.day && <p className="mt-1 text-sm text-ink">{i.hours.day.text}</p>}
                <p className="mt-1 break-words text-xs text-ink-muted">Why suggested: {i.reasons.join("; ")}.</p>
                <details className="mt-1 text-sm"><summary className="min-h-11 cursor-pointer py-2 text-teal-ink">Hours details</summary><HoursDetails answer={i.hours} /></details>
                {onAdd && (added?.(i)
                  ? <p className="mt-2 text-sm font-semibold text-teal-ink">On your trip</p>
                  : <button type="button" className="tm-action mt-2 min-h-11" onClick={() => onAdd(i)}>Add to my trip<span className="sr-only">: {i.name}</span></button>)}
              </li>
            ))}
          </ul>
          {town && onAdd && <p className="text-xs text-ink-muted">Adding a place keeps {place.name} on your trip.</p>}
          {around && <p className="text-xs text-ink-muted">Places: © OpenStreetMap contributors (ODbL) and Wikidata (CC0).</p>}
        </div>
      )}
    </section>
  );
}