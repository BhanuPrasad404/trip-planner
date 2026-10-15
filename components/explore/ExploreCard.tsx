"use client";

import { useState } from "react";
import { CategoryGlyph, Glyph } from "@/components/ui/Glyph";
import { PlacePhoto } from "@/components/ui/PlacePhoto";
import { SafeImg } from "@/components/ui/SafeImg";
import { exploreCategoryLabel } from "@/lib/explore/categories";
import { plannerCategory } from "@/lib/explore/glyph";
import type { ExploreItem } from "@/lib/explore/items";
import { googleMapsDirections, googleMapsPlace } from "@/lib/maps-links";
import type { PlacePhoto as Photo } from "@/lib/place-photos";

/** What researched season data says about this place, only when a researched entry matches it by name and location. */
export type SeasonNote = { good: boolean; yearRound: boolean; reason: string | null; source: string | null; months: string };

type Props = {
  item: ExploreItem;
  photo?: Photo;
  season: SeasonNote | null;
  saved: boolean;
  onToggleSave: () => void;
  /** Present only when a trip exists to add the place to. */
  added: boolean | null;
  onAdd: (() => void) | null;
};

const btn = "min-h-11 py-2 font-semibold underline underline-offset-2";

export function ExploreCard({ item, photo, season, saved, onToggleSave, added, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const panel = `explore-details-${item.id.replace("/", "-")}`;
  const glyph = plannerCategory(item.category);
  const fallback = <CategoryGlyph category={glyph} size={28} />;
  return (
    <li className="flex flex-col rounded-2xl border border-line bg-white p-5">
      <div className="mb-3">
        {photo || !item.photo ? (
          <PlacePhoto photo={photo} name={item.name} credit sizes="(min-width: 1280px) 30vw, (min-width: 640px) 45vw, 92vw" className="h-36 w-full" fallback={fallback} />
        ) : (
          <>
            <SafeImg src={item.photo.url} srcSet={item.photo.srcSet} sizes="(min-width: 640px) 45vw, 92vw" alt={`Photo of ${item.name}`} width={330} height={220} className="h-36 w-full rounded-xl object-cover" fallback={<span aria-hidden="true" className="flex h-36 w-full items-center justify-center rounded-xl bg-teal-light text-teal-ink">{fallback}</span>} />
            {item.photo.creditUrl && <a href={item.photo.creditUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-[11px] text-ink-muted underline underline-offset-2">Photo: Wikimedia Commons<span className="sr-only"> (opens in a new tab)</span></a>}
          </>
        )}
      </div>
      <div className="flex items-start justify-between gap-2">
        <h3 className="break-words font-display text-lg font-semibold text-pine"><CategoryGlyph category={glyph} size={18} className="mr-1.5 inline align-text-bottom text-teal" />{item.name}</h3>
        {season ? (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${season.yearRound ? "bg-sky text-ink-muted" : season.good ? "bg-teal-light text-teal-ink" : "bg-clay-light text-clay-ink"}`}>{season.yearRound ? "No seasonal pattern" : season.good ? "In season" : "Out of season"}</span>
        ) : item.notable ? <span className="shrink-0 rounded-full bg-teal-light px-2 py-0.5 text-xs font-semibold text-teal-ink">Well known</span> : null}
      </div>
      <p className="mt-0.5 text-xs text-ink-muted">{exploreCategoryLabel(item.category)}{item.heritage && " · Heritage listed"}{item.km !== undefined && ` · ${item.km} km away`}</p>

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-0 pt-3 text-sm">
        <a href={googleMapsPlace(item)} target="_blank" rel="noopener noreferrer" className={`${btn} text-teal-ink`}>Map<span className="sr-only"> of {item.name} (opens in a new tab)</span></a>
        <button type="button" aria-pressed={saved} onClick={onToggleSave} className={`${btn} ${saved ? "text-teal-ink" : "text-pine"}`}><span className="inline-flex items-center gap-1.5">{saved && <Glyph name="check" size={16} />}{saved ? "Saved" : "Save"}<span className="sr-only"> {item.name}</span></span></button>
        {onAdd && (added ? <span className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-teal-ink"><Glyph name="check" size={16} />Added to Ideas</span> : <button type="button" onClick={onAdd} className={`${btn} text-pine`}>Add to my ideas<span className="sr-only">: {item.name}</span></button>)}
        <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((v) => !v)} className={`${btn} ml-auto text-ink-muted`}>{open ? "Hide details" : "Details"}</button>
      </div>

      {open && (
        <div id={panel} className="mt-2 space-y-1.5 border-t border-line pt-3 text-sm">
          <p><span className="font-semibold text-pine">Location</span> <span className="font-mono text-xs text-ink-muted">{item.lat.toFixed(4)}, {item.lng.toFixed(4)}</span></p>
          <p><span className="font-semibold text-pine">Opening hours</span> {item.hours ? <span className="font-mono text-xs">{item.hours}</span> : <span className="text-ink-muted">Not listed on the map. Check before you go.</span>}</p>
          {season && (
            <p><span className="font-semibold text-pine">Best months</span> <span className="font-mono text-xs">{season.months}</span>{season.reason && <span className="block text-ink-muted">{season.reason}</span>}{season.source && <span className="block text-xs text-ink-muted">Researched · {season.source}</span>}</p>
          )}
          {!season && <p className="text-xs text-ink-muted">We haven&apos;t researched the best months for this place yet, so it isn&apos;t marked in or out of season. Check the weather before you go.</p>}
          <p className="flex flex-wrap gap-x-4">
            <a href={googleMapsDirections(item)} target="_blank" rel="noopener noreferrer" className="min-h-11 py-2 font-semibold text-teal-ink underline underline-offset-2">Directions<span className="sr-only"> to {item.name} (opens in a new tab)</span></a>
            {item.website && <a href={item.website} target="_blank" rel="noopener noreferrer nofollow" className="min-h-11 py-2 font-semibold text-teal-ink underline underline-offset-2">Website<span className="sr-only"> (opens in a new tab)</span></a>}
            {item.wikipedia && <a href={item.wikipedia} target="_blank" rel="noopener noreferrer" className="min-h-11 py-2 font-semibold text-teal-ink underline underline-offset-2">Wikipedia<span className="sr-only"> (opens in a new tab)</span></a>}
            {item.wikidata && <a href={`https://www.wikidata.org/wiki/${item.wikidata}`} target="_blank" rel="noopener noreferrer" className="min-h-11 py-2 font-semibold text-teal-ink underline underline-offset-2">Wikidata<span className="sr-only"> (opens in a new tab)</span></a>}
          </p>
        </div>
      )}
    </li>
  );
}
