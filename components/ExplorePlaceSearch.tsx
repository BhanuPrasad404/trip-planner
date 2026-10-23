"use client";

import { useId, useState } from "react";
import { useDestinationSearch } from "@/lib/client/use-destination-search";
import type { PlaceChoice } from "@/lib/feed/compose";
import { Glyph } from "@/components/ui/Glyph";

type Props = { onPick: (place: PlaceChoice) => void; near?: { lat: number; lng: number } | null };

const MAX_SHOWN = 8;

/**
 * "Where do you want to explore?" for the Explore page: any city, town or landmark in India, picked in one tap.
 * (Not the same job as PlaceSearch, which fills one form field and shows the chosen place; both share the search logic in
 * useDestinationSearch.) Instantly offers places travellers have shared, and the popular ones before you type; the map search covers
 * everywhere else and runs only when asked, because the free geocoder forbids as-you-type search and each one uses a daily lookup.
 */
export function ExplorePlaceSearch({ onPick, near = null }: Props) {
  const [q, setQ] = useState("");
  const id = useId();
  const s = useDestinationSearch(q, near);
  const typed = q.trim();
  const shown = s.results.slice(0, MAX_SHOWN);

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-pine">Explore anywhere in India</label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" enterKeyHint="search" maxLength={120}
          onKeyDown={(e) => { if (e.key === "Enter" && typed.length >= 2) { e.preventDefault(); s.searchMap(); } }}
          placeholder="A city, town or landmark, e.g. Hampi, Munnar, Jaisalmer"
          className="min-h-11 w-full min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-base sm:min-w-[18rem]"
        />
        {typed.length >= 2 && (
          <button type="button" onClick={s.searchMap} disabled={s.mapLoading} className="min-h-11 rounded-xl border border-teal bg-teal-light px-4 text-sm font-semibold text-teal-ink disabled:opacity-60">
            {s.mapLoading ? "Searching…" : s.mapSearched ? "Search again" : "Search the map"}
          </button>
        )}
      </div>

      <div aria-live="polite" className="mt-2">
        {s.mapError && <p role="alert" className="text-sm font-semibold text-clay-ink">{s.mapError}</p>}
        {typed.length >= 2 && s.mapSearched && s.results.length === 0 && <p className="text-sm text-ink-muted">Nothing found for “{typed}”. Try the name of a nearby town.</p>}
        {typed.length === 0 && shown.length > 0 && <p className="text-xs text-ink-muted">Popular with travellers</p>}
        {shown.length > 0 && (
          <ul className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {shown.map((p) => (
              <li key={`${p.name}|${p.lat.toFixed(3)},${p.lng.toFixed(3)}`}>
                <button type="button" onClick={() => onPick(p)} className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-left text-sm hover:border-teal">
                  <Glyph name="pin" size={16} className="shrink-0 text-teal" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-semibold text-pine">{p.name}</span>
                    {p.address && <span className="block truncate text-xs text-ink-muted">{p.address}</span>}
                  </span>
                  {p.source === "trailmate" && <span className="shrink-0 rounded-full bg-teal-light px-2 py-0.5 text-[11px] font-semibold text-teal-ink">Shared by travellers</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
