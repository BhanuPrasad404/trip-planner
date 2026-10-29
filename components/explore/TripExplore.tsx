"use client";

// "What is worth a stop on MY trip?" The top of Explore for anyone with a trip. It follows what the traveller is doing: along the whole
// planned road before the trip, along what is LEFT of it while travelling, round the place they are staying when the plan is done.
// Every line under a place is calculated (lib/explore/route-rank.ts); where we don't know, it says so. Nothing here changes the trip:
// "Add to Ideas" puts a place in the ideas list, never into the schedule.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DestinationSheet } from "@/components/feed/DestinationSheet";
import { communityLine } from "@/lib/explore/community";
import { AddStopSheet } from "./AddStopSheet";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Glyph } from "@/components/ui/Glyph";
import { EXPLORE_CATEGORIES, exploreCategoryLabel, type ExploreCategoryId } from "@/lib/explore/categories";
import { plannerCategory } from "@/lib/explore/glyph";
import type { RoutedItem } from "@/lib/explore/route-rank";
import { useTripExplore, type TripExploreQuery } from "@/lib/client/use-trip-explore";
import { useDeviceHere } from "@/lib/client/use-device-here";
import { usePlacePhotos } from "@/lib/client/use-place-photos";
import type { useSavedPlaces } from "@/lib/client/use-saved-places";
import { ExploreCard } from "./ExploreCard";

type Saved = ReturnType<typeof useSavedPlaces>;
type Radius = TripExploreQuery["radiusKm"];
type Props = {
  tripId: string;
  saved: Saved;
  added: Set<string>;
  addIdea: (p: { key: string; name: string; lat: number; lng: number; category?: string | null }) => Promise<void>;
  addError: string | null;
};

const chip = (on: boolean) => `min-h-11 rounded-full border px-3 text-sm font-semibold ${on ? "border-pine bg-pine text-white" : "border-line bg-white text-ink-muted hover:border-teal"}`;
const EYEBROW = { planned: "From your plan", active: "On the road", staying: "Where you are", none: "" } as const;

export function TripExplore({ tripId, saved, added, addIdea, addError }: Props) {
  const [category, setCategory] = useState<ExploreCategoryId | "all">("all");
  const [radius, setRadius] = useState<Radius>(10);
  const router = useRouter();
  const [reportsFor, setReportsFor] = useState<RoutedItem | null>(null);
  const [stopFor, setStopFor] = useState<RoutedItem | null>(null);
  // The clock for "latest 2 days ago": read once when the section opens.
  const [nowMs] = useState(() => Date.now());
  const { here, request } = useDeviceHere();
  const position = here.status === "on" ? { lat: here.lat, lng: here.lng } : null;
  const state = useTripExplore({ tripId, category, radiusKm: radius, position });
  const a = state.answer;
  const items = useMemo(() => a?.items ?? [], [a]);
  const photos = usePlacePhotos(items.map((i) => ({ key: `explore-${i.id}`, name: i.name, lat: i.lat, lng: i.lng })));

  // No trip context (finished trip, or nothing to go on): the ordinary Explore below is the whole page.
  if (a && a.mode === "none") return null;

  const staying = a?.mode === "staying" || (a?.route === null && !!a);
  const widths: { value: string; label: string }[] = ([5, 10, 20] as const).map((r) => ({ value: String(r), label: staying ? `${Math.min(30, r * 2)} km round the place` : `${r} km either side of the road` }));
  const catLabel = category === "all" ? "places" : exploreCategoryLabel(category).toLowerCase();
  const toSaved = (i: RoutedItem) => ({ key: i.id, name: i.name, lat: i.lat, lng: i.lng, category: plannerCategory(i.category), region: null });

  return (
    <section aria-labelledby="trip-explore-heading" className="rounded-3xl border border-line bg-white p-5 sm:p-6">
      {a && <p className="font-mono text-xs font-semibold uppercase tracking-widest text-marigold">{EYEBROW[a.mode]}</p>}
      <h2 id="trip-explore-heading" className="mt-1 break-words font-display text-2xl font-semibold text-pine">{a ? a.headline : "Finding places for your trip…"}</h2>
      {a?.route && <p className="mt-1 text-sm text-ink-muted">{a.route.km} km of road{a.remainingStops > 0 ? ` · ${a.remainingStops} ${a.remainingStops === 1 ? "stop" : "stops"} still to do` : ""}</p>}
      {a && a.notes.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {a.notes.map((n) => <li key={n} role="note" className="flex items-start gap-2 rounded-xl bg-sky/70 px-3 py-2 text-sm text-ink"><Glyph name="info" size={15} className="mt-0.5" /><span>{n}</span></li>)}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="What to look for">
        <button type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")} className={chip(category === "all")}>All</button>
        {EXPLORE_CATEGORIES.map((c) => <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(category === c.id ? "all" : c.id)} className={chip(category === c.id)}>{c.label}</button>)}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem]">
          <label htmlFor="trip-explore-width" className="text-sm font-semibold text-pine">How far</label>
          <div className="mt-1"><Select id="trip-explore-width" label="How far from your route" value={String(radius)} onChange={(v) => setRadius(Number(v) as Radius)} options={widths} /></div>
        </div>
        {a && a.mode !== "planned" && here.status !== "on" && (
          <div>
            <Button variant="secondary" onClick={request} disabled={here.status === "asking"}><Glyph name="locate" size={16} />{here.status === "asking" ? "Asking…" : "Use my location"}</Button>
            <p className="mt-1 max-w-xs text-xs text-ink-muted">{here.status === "denied" ? "Location is blocked in this browser. The list still works from your plan." : "Used for this list only, and never saved or shared."}</p>
          </div>
        )}
      </div>

      {addError && <p role="alert" className="mt-2 text-sm font-semibold text-clay-ink">{addError}</p>}
      <div aria-live="polite" className="mt-4">
        {state.status === "loading" && <Skeleton />}
        {state.status === "error" && (
          <div role="alert" className="rounded-2xl border border-clay/40 bg-clay-light/50 p-4 text-sm">
            <p className="font-semibold text-clay-ink">{state.error}</p>
            <p className="mt-1 text-ink-muted">You can still search for a place or a state below.</p>
            <div className="mt-2"><Button size="sm" variant="secondary" onClick={state.retry}>Try again</Button></div>
          </div>
        )}
        {state.status === "ready" && a && items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line bg-white/70 p-5 text-sm text-ink-muted">
            {a.empty === "no_data"
              ? <p>The map has no {catLabel} listed {staying ? "around here" : "along this road"} yet. Coverage is thinner for small places, so this doesn&apos;t mean there is nothing to see. Try another kind of place, or search a nearby town below.</p>
              : <p>There are {catLabel} in the area, but none within {staying ? `${Math.min(30, radius * 2)} km` : `${radius} km of your route`}.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {category !== "all" && <Button size="sm" variant="secondary" onClick={() => setCategory("all")}>Show all kinds</Button>}
              {radius !== 20 && <Button size="sm" variant="secondary" onClick={() => setRadius(radius === 5 ? 10 : 20)}>Look wider</Button>}
            </div>
          </div>
        )}
        {state.status === "ready" && a && items.length > 0 && (
          <>
            <p className="mb-2 text-xs text-ink-muted">Showing {items.length} of {a.total} {catLabel}{a.coverage?.stale ? " · saved list" : ""}</p>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((i) => (
                <ExploreCard
                  key={i.id} item={i} photo={photos[`explore-${i.id}`]} season={null} reasons={i.reasons}
                  saved={saved.isSaved(i.id)} onToggleSave={() => void saved.toggle(toSaved(i))}
                  added={added.has(i.id)} onAdd={() => void addIdea({ key: i.id, name: i.name, lat: i.lat, lng: i.lng, category: plannerCategory(i.category) })}
                  community={i.community ? communityLine(i.community, nowMs) : null} onCommunity={i.community ? () => setReportsFor(i) : undefined}
                  onAddStop={a.mode === "staying" && a.remainingStops === 0 ? undefined : () => setStopFor(i)}
                />
              ))}
            </ul>
            {state.hasMore && <div className="mt-4 flex justify-center"><Button variant="ghost" onClick={state.loadMore} disabled={state.loadingMore}>{state.loadingMore ? "Loading…" : "Show more places"}</Button></div>}
            {state.error && <p role="alert" className="mt-2 text-center text-sm font-semibold text-clay-ink">{state.error}</p>}
          </>
        )}
      </div>
      {reportsFor?.community && (
        <DestinationSheet destinationId={reportsFor.community.destinationId} name={reportsFor.community.name} onClose={() => setReportsFor(null)}
          onAddToTrip={() => { const it = reportsFor; setReportsFor(null); setStopFor(it); }} onShare={() => router.push("/discover")} />
      )}
      {stopFor && (
        <AddStopSheet tripId={tripId} place={{ id: stopFor.id, name: stopFor.name, lat: stopFor.lat, lng: stopFor.lng, category: stopFor.category }} onClose={() => setStopFor(null)}
          onSaveIdea={() => void addIdea({ key: stopFor.id, name: stopFor.name, lat: stopFor.lat, lng: stopFor.lng, category: plannerCategory(stopFor.category) })} />
      )}
      <p className="mt-4 text-[11px] text-ink-muted">Place data © OpenStreetMap contributors (ODbL). Opening hours say where they come from and whether anyone confirmed them; unconfirmed map hours are labelled so. We don&apos;t show crowds, ratings or &ldquo;open now&rdquo; because we have no reliable source for them here. Traveller reports come from posts in Discover; each shows how old it is.</p>
    </section>
  );
}

function Skeleton() {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading places" aria-busy="true">
      {Array.from({ length: 3 }, (_, i) => (
        <li key={i} className="rounded-2xl border border-line bg-white p-5"><div className="h-36 animate-pulse rounded-xl bg-sky motion-reduce:animate-none" /><div className="mt-3 h-5 w-2/3 animate-pulse rounded bg-sky motion-reduce:animate-none" /><div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-sky motion-reduce:animate-none" /></li>
      ))}
    </ul>
  );
}
