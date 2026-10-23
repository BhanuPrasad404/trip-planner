"use client";

import { useMemo, useState } from "react";
import { ExplorePlaceSearch } from "@/components/ExplorePlaceSearch";
import { CategoryGlyph } from "@/components/ui/Glyph";
import { ExploreCard, type SeasonNote } from "@/components/explore/ExploreCard";
import { Button } from "@/components/ui/Button";
import { CATEGORIES, normalizeCategory, type PlaceCategory } from "@/lib/categories";
import { useExplore } from "@/lib/client/use-explore";
import { usePlacePhotos } from "@/lib/client/use-place-photos";
import type { useSavedPlaces } from "@/lib/client/use-saved-places";
import { EXPLORE_CATEGORIES, exploreCategoryLabel, type ExploreCategoryId } from "@/lib/explore/categories";
import { plannerCategory } from "@/lib/explore/glyph";
import type { ExploreItem } from "@/lib/explore/items";
import type { ExploreScope } from "@/lib/explore/query";
import { REGIONS, regionByCode } from "@/lib/explore/regions";
import { googleMapsPlace } from "@/lib/maps-links";
import { matchSeasonTag } from "@/lib/season-match";
import type { PlaceChoice } from "@/lib/feed/compose";
import type { ExploreSeasonTag } from "@/components/ExploreView";

export type Anchor = { id: string; label: string; lat: number; lng: number };
type Saved = ReturnType<typeof useSavedPlaces>;
type AddIdea = (p: { key: string; name: string; lat: number; lng: number; category?: string | null; seasonId?: string }) => Promise<void>;

type Props = {
  tripId: string | null;
  anchors: Anchor[];
  anchorId: string;
  onAnchorChange: (id: string) => void;
  onPickPlace: (p: PlaceChoice) => void;
  /** Season rows that have a researched source (the only ones we show as "in season"). */
  researched: ExploreSeasonTag[];
  month: number;
  saved: Saved;
  added: Set<string>;
  addIdea: AddIdea;
  addError: string | null;
};

const MONTH = (m: number) => new Date(2000, m - 1, 1).toLocaleString("en-IN", { month: "short" });
const RADII = [10, 25, 50];
const chip = (on: boolean) => `min-h-11 rounded-full border px-3 text-sm font-semibold ${on ? "border-pine bg-pine text-white" : "border-line bg-white text-ink-muted hover:border-teal"}`;

export function DiscoverSection({ tripId, anchors, anchorId, onAnchorChange, onPickPlace, researched, month, saved, added, addIdea, addError }: Props) {
  const [tab, setTab] = useState<"discover" | "saved">("discover");
  const [mode, setMode] = useState<"region" | "place">(anchors.length > 0 ? "place" : "region");
  const [region, setRegion] = useState("");
  const [radius, setRadius] = useState(25);
  const [category, setCategory] = useState<ExploreCategoryId | "all">("all");
  const [sort, setSort] = useState<"notable" | "nearest">("notable");
  const [q, setQ] = useState("");

  const anchor = anchors.find((a) => a.id === anchorId) ?? anchors[0] ?? null;
  const scope = useMemo<ExploreScope | null>(
    () => (mode === "region" ? (region ? { kind: "state", code: region } : null) : anchor ? { kind: "point", lat: anchor.lat, lng: anchor.lng, radius_km: radius } : null),
    [mode, region, anchor, radius],
  );
  // Distances are measured from the chosen place, or (browsing a region) from the trip's destination when there is one.
  const distanceFrom = mode === "place" ? anchor : (anchors[0] ?? null);
  const canSortNearest = !!distanceFrom;
  const state = useExplore({ scope, category, sort: sort === "nearest" && canSortNearest ? "nearest" : "notable", q, anchor: distanceFrom ? { lat: distanceFrom.lat, lng: distanceFrom.lng } : null });
  const photos = usePlacePhotos(state.items.map((i) => ({ key: `explore-${i.id}`, name: i.name, lat: i.lat, lng: i.lng })));

  const seasonOf = useMemo(() => {
    const out = new Map<string, SeasonNote>();
    for (const i of state.items) {
      const t = matchSeasonTag({ name: i.name, lat: i.lat, lng: i.lng }, researched);
      if (!t) continue;
      const full = researched.find((r) => r.id === t.id);
      out.set(i.id, {
        good: t.good_months.includes(month), yearRound: new Set(t.good_months).size >= 12, reason: t.reason,
        months: t.good_months.map(MONTH).join(", "), source: full?.source_urls?.[0] ? safeHost(full.source_urls[0]) : null,
      });
    }
    return out;
  }, [state.items, researched, month]);

  const regionName = region ? regionByCode(region)?.name : null;
  const where = mode === "region" ? (regionName ?? "India") : `${radius} km around ${anchor?.label ?? "your place"}`;
  const catLabel = category === "all" ? "places" : exploreCategoryLabel(category).toLowerCase();
  const toSaved = (i: ExploreItem) => ({ key: i.id, name: i.name, lat: i.lat, lng: i.lng, category: plannerCategory(i.category), region: regionName ?? null });

  return (
    <section aria-labelledby="discover-heading" className="rounded-3xl border border-line bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="discover-heading" className="font-display text-2xl font-semibold text-pine">Discover places across India</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">Real places from OpenStreetMap, well-known ones first, in every state and union territory. Photos come from Wikipedia and Wikimedia Commons (free licences, credited), only where a real one exists.</p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Discover or saved">
          <button type="button" aria-pressed={tab === "discover"} onClick={() => setTab("discover")} className={chip(tab === "discover")}>Discover</button>
          <button type="button" aria-pressed={tab === "saved"} onClick={() => setTab("saved")} className={chip(tab === "saved")}>Saved{saved.places.length > 0 && ` (${saved.places.length})`}</button>
        </div>
      </div>
      {saved.error && <p role="alert" className="mt-2 text-sm font-semibold text-clay-ink">{saved.error}</p>}
      {addError && <p role="alert" className="mt-2 text-sm font-semibold text-clay-ink">{addError}</p>}

      {tab === "saved" ? (
        <SavedList saved={saved} tripId={tripId} added={added} addIdea={addIdea} />
      ) : (
        <>
          <div className="mt-4"><ExplorePlaceSearch onPick={(p) => { setMode("place"); onPickPlace(p); }} /></div>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="How to look">
            <button type="button" aria-pressed={mode === "region"} onClick={() => setMode("region")} className={chip(mode === "region")}>By state or UT</button>
            <button type="button" aria-pressed={mode === "place"} onClick={() => setMode("place")} className={chip(mode === "place")}>Around a place</button>
          </div>

          {mode === "region" ? (
            <div className="mt-3">
              <label className="text-sm font-semibold text-pine" htmlFor="explore-region">State or union territory</label>
              <select id="explore-region" value={region} onChange={(e) => setRegion(e.target.value)} className="mt-1 block min-h-11 w-full max-w-sm rounded-xl border border-line bg-white px-3 text-base">
                <option value="">Choose…</option>
                <optgroup label="States">{REGIONS.filter((r) => r.kind === "state").map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</optgroup>
                <optgroup label="Union territories">{REGIONS.filter((r) => r.kind === "ut").map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</optgroup>
              </select>
              {!region && (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Quick pick">
                  {REGIONS.map((r) => <li key={r.code}><button type="button" onClick={() => setRegion(r.code)} className="min-h-11 rounded-full border border-line bg-white px-3 text-sm text-ink-muted hover:border-teal">{r.name}</button></li>)}
                </ul>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {anchors.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-sm font-semibold text-pine">Around <select value={anchor?.id ?? ""} onChange={(e) => onAnchorChange(e.target.value)} className="ml-1 min-h-11 rounded-lg border border-line bg-white px-2 text-sm font-normal">{anchors.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
                  <label className="text-sm font-semibold text-pine">Within <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="ml-1 min-h-11 rounded-lg border border-line bg-white px-2 text-sm font-normal">{RADII.map((r) => <option key={r} value={r}>{r} km</option>)}</select></label>
                </div>
              )}
              {anchors.length === 0 && <p className="text-sm text-ink-muted">Search for a city, town or landmark above, or create a trip to explore around its destination.</p>}
            </div>
          )}

          {scope && (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by type">
                <button type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")} className={chip(category === "all")}>All</button>
                {EXPLORE_CATEGORIES.map((c) => <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(category === c.id ? "all" : c.id)} className={chip(category === c.id)}><CategoryGlyph category={plannerCategory(c.id)} size={15} className="mr-1.5 inline align-text-bottom" />{c.label}</button>)}
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div className="min-w-[12rem] flex-1">
                  <label htmlFor="explore-q" className="text-sm font-semibold text-pine">Search these results</label>
                  <input id="explore-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} autoComplete="off" placeholder="e.g. fort, falls, a name" className="mt-1 block min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base" />
                </div>
                <label className="text-sm font-semibold text-pine">Sort <select value={sort} onChange={(e) => setSort(e.target.value as "notable" | "nearest")} className="ml-1 min-h-11 rounded-lg border border-line bg-white px-2 text-sm font-normal"><option value="notable">Well known first</option>{canSortNearest && <option value="nearest">Nearest to {distanceFrom?.label}</option>}</select></label>
              </div>
            </>
          )}

          <div aria-live="polite" className="mt-4">
            {!scope && mode === "region" && <p className="text-sm text-ink-muted">Choose a state or union territory to see its places.</p>}
            {scope && state.status === "loading" && <Skeleton />}
            {state.status === "error" && (
              <p role="alert" className="rounded-2xl border border-line bg-clay-light/40 p-4 text-sm font-semibold text-clay-ink">{state.error} <Button size="sm" variant="ghost" onClick={state.retry}>Try again</Button></p>
            )}
            {state.status === "ready" && state.stale && <p className="mb-2 rounded-xl bg-sky px-3 py-2 text-xs text-ink-muted">The map servers are busy, so this is the list we saved{state.fetchedAt ? ` on ${new Date(state.fetchedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}` : ""}. It may be slightly out of date.</p>}
            {state.status === "ready" && state.items.length === 0 && (
              <p className="rounded-2xl border border-dashed border-line bg-white/70 p-6 text-sm text-ink-muted">
                {q.trim() ? `Nothing in these results matches “${q.trim()}”.` : `No ${catLabel} found in ${where}. The map may list few places there.`}{" "}
                {(category !== "all" || q.trim()) && <button type="button" onClick={() => { setCategory("all"); setQ(""); }} className="tm-action min-h-11 font-semibold">Show everything</button>}
              </p>
            )}
            {state.status === "ready" && state.items.length > 0 && (
              <>
                <p className="mb-2 text-xs text-ink-muted">Showing {state.items.length} of {state.total} {catLabel} · {where}</p>
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {state.items.map((i) => (
                    <ExploreCard key={i.id} item={i} photo={photos[`explore-${i.id}`]} season={seasonOf.get(i.id) ?? null}
                      saved={saved.isSaved(i.id)} onToggleSave={() => void saved.toggle(toSaved(i))}
                      added={tripId ? added.has(i.id) : null}
                      onAdd={tripId ? () => void addIdea({ key: i.id, name: i.name, lat: i.lat, lng: i.lng, category: plannerCategory(i.category) }) : null} />
                  ))}
                </ul>
                {state.hasMore && <div className="mt-4 flex justify-center"><Button variant="ghost" onClick={state.loadMore} disabled={state.loadingMore}>{state.loadingMore ? "Loading…" : "Show more places"}</Button></div>}
                {state.error && state.items.length > 0 && <p role="alert" className="mt-2 text-center text-sm font-semibold text-clay-ink">{state.error}</p>}
              </>
            )}
          </div>
          <p className="mt-4 text-[11px] text-ink-muted">Place data © OpenStreetMap contributors (ODbL). Opening hours are shown as listed on the map and are not checked. Price and rating filters will appear once a source for them is connected; we don&apos;t guess.</p>
        </>
      )}
    </section>
  );
}

function safeHost(url: string): string | null { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; } }

function Skeleton() {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading places" aria-busy="true">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="rounded-2xl border border-line bg-white p-5"><div className="h-36 animate-pulse rounded-xl bg-sky motion-reduce:animate-none" /><div className="mt-3 h-5 w-2/3 animate-pulse rounded bg-sky motion-reduce:animate-none" /><div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-sky motion-reduce:animate-none" /></li>
      ))}
    </ul>
  );
}

function SavedList({ saved, tripId, added, addIdea }: { saved: Saved; tripId: string | null; added: Set<string>; addIdea: AddIdea }) {
  if (!saved.ready) return <p className="mt-4 text-sm text-ink-muted">Loading your saved places…</p>;
  if (saved.loadFailed) return <p role="alert" className="mt-4 text-sm font-semibold text-clay-ink">Couldn&apos;t load your saved places. Please try again in a moment.</p>;
  if (saved.places.length === 0) return <p className="mt-4 rounded-2xl border border-dashed border-line bg-white/70 p-6 text-sm text-ink-muted">Nothing saved yet. Tap Save on any place to keep it here, with or without a trip.</p>;
  return (
    <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {saved.places.map((p) => {
        const cat = plannerCategorySafe(p.category);
        return (
          <li key={p.key} className="rounded-xl border border-line p-3 text-sm">
            <p className="break-words font-semibold text-pine"><CategoryGlyph category={cat} size={16} className="mr-1.5 inline align-text-bottom text-teal" />{p.name}</p>
            <p className="text-xs text-ink-muted">{CATEGORIES[cat].label}{p.region && ` · ${p.region}`}</p>
            <div className="mt-1 flex flex-wrap gap-x-4">
              <a href={googleMapsPlace(p)} target="_blank" rel="noopener noreferrer" className="tm-action min-h-11 py-2 font-semibold">Map<span className="sr-only"> of {p.name} (opens in a new tab)</span></a>
              {tripId && (added.has(p.key) ? <span className="inline-flex min-h-11 items-center font-semibold text-teal-ink">Added to Ideas</span> : <button type="button" onClick={() => void addIdea({ key: p.key, name: p.name, lat: p.lat, lng: p.lng, category: cat })} className="tm-action min-h-11 py-2 font-semibold">Add to my ideas</button>)}
              <button type="button" onClick={() => void saved.toggle(p)} className="tm-action min-h-11 py-2 font-semibold text-clay-ink">Remove<span className="sr-only"> {p.name}</span></button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const plannerCategorySafe = (raw: string | null | undefined): PlaceCategory => normalizeCategory(raw);
