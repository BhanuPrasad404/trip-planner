"use client";

import { useState } from "react";
import { CategoryGlyph, Glyph } from "@/components/ui/Glyph";
import { PlacePhoto } from "@/components/ui/PlacePhoto";
import { SafeImg } from "@/components/ui/SafeImg";
import { exploreCategoryLabel } from "@/lib/explore/categories";
import { plannerCategory } from "@/lib/explore/glyph";
import { sourceLabel, type ExploreItem } from "@/lib/explore/items";
import { googleMapsDirections, googleMapsPlace } from "@/lib/maps-links";
import type { PlacePhoto as Photo } from "@/lib/place-photos";
import { PlaceHours, exploreItemRef } from "@/components/place/PlaceHours";

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
  /** Why this place is on the list, made only from numbers we calculated (lib/explore/route-rank.ts). */
  reasons?: string[];
  /** The traveller feed for this exact place, when there is one (lib/explore/community.ts). */
  community?: { text: string; fresh: "new" | "recent" | "old" | "none" } | null;
  onCommunity?: () => void;
  /** Present when the place can be added as a stop (with a preview of what it changes first). */
  onAddStop?: () => void;
};

const ghost = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-sm font-semibold text-pine hover:border-teal";
const solid = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-pine bg-pine px-4 text-sm font-semibold text-white hover:opacity-90";

export function ExploreCard({ item, photo, season, saved, onToggleSave, added, onAdd, reasons, community, onCommunity, onAddStop }: Props) {
  const [open, setOpen] = useState(false);
  const panel = `explore-details-${item.id.replace(/[/:]/g, "-")}`;
  const glyph = plannerCategory(item.category);
  const fallback = <CategoryGlyph category={glyph} size={36} />;
  const badge = season
    ? { text: season.yearRound ? "No seasonal pattern" : season.good ? "In season" : "Out of season", cls: season.yearRound ? "bg-sky text-ink-muted" : season.good ? "bg-teal-light text-teal-ink" : "bg-clay-light text-clay-ink" }
    : item.notable ? { text: "Well known", cls: "bg-white text-teal-ink" } : null;
  return (
    <li data-card="place" className="flex flex-col overflow-hidden rounded-3xl border border-line bg-white p-2">
      <div className="relative">
        {photo || !item.photo ? (
          <PlacePhoto photo={photo} name={item.name} credit sizes="(min-width: 1280px) 30vw, (min-width: 640px) 45vw, 92vw" className="aspect-[16/10] w-full [&_img]:rounded-2xl [&>span]:rounded-2xl" fallback={fallback} />
        ) : (
          <>
            <SafeImg src={item.photo.url} srcSet={item.photo.srcSet} sizes="(min-width: 640px) 45vw, 92vw" alt={`Photo of ${item.name}`} width={330} height={206} className="aspect-[16/10] w-full rounded-2xl object-cover" fallback={<span aria-hidden="true" className="flex aspect-[16/10] w-full items-center justify-center rounded-2xl bg-teal-light text-teal-ink">{fallback}</span>} />
            {item.photo.creditUrl && <a href={item.photo.creditUrl} target="_blank" rel="noopener noreferrer" className="absolute inset-x-0 bottom-0 truncate rounded-b-2xl bg-black/55 px-2 py-0.5 text-[10px] text-white">Photo: Wikimedia Commons<span className="sr-only"> (opens in a new tab)</span></a>}
          </>
        )}
        <button type="button" aria-pressed={saved} onClick={onToggleSave} className="absolute right-2.5 top-2.5 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-pine shadow-card transition active:scale-90">
          <Glyph name="heart" size={20} className={saved ? "fill-clay text-clay" : ""} /><span className="sr-only">{saved ? "Saved" : "Save"} {item.name}</span>
        </button>
        {badge && <span className={`absolute left-2.5 top-2.5 max-w-[60%] truncate rounded-full px-2.5 py-1 text-xs font-semibold shadow-card ${badge.cls}`}>{badge.text}</span>}
      </div>
      <div className="flex flex-1 flex-col px-3 pb-3 pt-3">
        <h3 className="break-words font-display text-xl font-semibold leading-snug text-pine">{item.name}</h3>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted"><CategoryGlyph category={glyph} size={15} className="shrink-0 text-teal" /><span>{exploreCategoryLabel(item.category)}{item.heritage && " · Heritage listed"}{item.km !== undefined && ` · ${item.km} km away`}</span></p>

        {reasons && reasons.length > 0 && (
          <ul aria-label={`Why ${item.name} is suggested`} className="mt-2 space-y-1 text-sm text-ink">
            {reasons.map((r) => <li key={r} className="flex items-start gap-2"><span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-teal" /><span>{r}</span></li>)}
          </ul>
        )}

        {community && onCommunity && (
          <button type="button" onClick={onCommunity} className="mt-2 inline-flex min-h-11 items-center gap-2 self-start text-left text-sm font-semibold text-teal-ink underline underline-offset-2">
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${community.fresh === "new" ? "bg-teal" : community.fresh === "recent" ? "bg-marigold" : "bg-line"}`} />
            {community.text}<span className="sr-only">: what travellers say about {item.name}</span>
          </button>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          {onAddStop && <button type="button" onClick={onAddStop} className={solid}>Add as a stop<span className="sr-only">: {item.name}</span></button>}
          {onAdd && (added ? <span className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-teal-ink"><Glyph name="check" size={16} />Added to Ideas</span> : <button type="button" onClick={onAdd} className={onAddStop ? ghost : solid}>Add to my ideas<span className="sr-only">: {item.name}</span></button>)}
          <a href={googleMapsPlace(item)} target="_blank" rel="noopener noreferrer" className={ghost}>Map<span className="sr-only"> of {item.name} (opens in a new tab)</span></a>
          <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((v) => !v)} className="ml-auto inline-flex min-h-11 items-center gap-1 px-2 text-sm font-semibold text-ink-muted">{open ? "Hide details" : "Details"}<Glyph name={open ? "up" : "down"} size={16} /></button>
        </div>
      {open && (
        <div id={panel} className="mt-2 space-y-1.5 border-t border-line pt-3 text-sm">
          <p><span className="font-semibold text-pine">Location</span> <span className="font-mono text-xs text-ink-muted">{item.lat.toFixed(4)}, {item.lng.toFixed(4)}</span></p>
          <div><p className="font-semibold text-pine">Opening hours</p><PlaceHours place={exploreItemRef(item)} /></div>
          <p><span className="font-semibold text-pine">Source</span> <span className="text-xs text-ink-muted">{sourceLabel(item) ?? "OpenStreetMap, looked up just now"}</span></p>
          {season && (
            <p><span className="font-semibold text-pine">Best months</span> <span className="font-mono text-xs">{season.months}</span>{season.reason && <span className="block text-ink-muted">{season.reason}</span>}{season.source && <span className="block text-xs text-ink-muted">Researched · {season.source}</span>}</p>
          )}
          {!season && <p className="text-xs text-ink-muted">We haven&apos;t researched the best months for this place yet, so it isn&apos;t marked in or out of season. Check the weather before you go.</p>}
          <p className="flex flex-wrap gap-x-4">
            <a href={googleMapsDirections(item)} target="_blank" rel="noopener noreferrer" className="tm-action min-h-11 py-2 font-semibold">Directions<span className="sr-only"> to {item.name} (opens in a new tab)</span></a>
            {item.website && <a href={item.website} target="_blank" rel="noopener noreferrer nofollow" className="tm-action min-h-11 py-2 font-semibold">Website<span className="sr-only"> (opens in a new tab)</span></a>}
            {item.wikipedia && <a href={item.wikipedia} target="_blank" rel="noopener noreferrer" className="tm-action min-h-11 py-2 font-semibold">Wikipedia<span className="sr-only"> (opens in a new tab)</span></a>}
            {item.wikidata && <a href={`https://www.wikidata.org/wiki/${item.wikidata}`} target="_blank" rel="noopener noreferrer" className="tm-action min-h-11 py-2 font-semibold">Wikidata<span className="sr-only"> (opens in a new tab)</span></a>}
          </p>
        </div>
      )}
      </div>
    </li>
  );
}
