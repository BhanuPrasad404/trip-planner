"use client";

import { useMemo, useState } from "react";
import { useDestinationSearch } from "@/lib/client/use-destination-search";
import { SPOT_CHIPS, type PlaceChoice } from "@/lib/feed/compose";
import { CheckIcon, PinIcon, SearchIcon, ShieldIcon } from "../icons";

type Props = {
  place: PlaceChoice | null;
  spot: string;
  precision: "approx" | "exact";
  onPlace: (p: PlaceChoice | null) => void;
  onSpot: (s: string) => void;
  onPrecision: (p: "approx" | "exact") => void;
};

function Row({ p, onPick }: { p: PlaceChoice; onPick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onPick} className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left hover:bg-teal-light/60 focus-visible:bg-teal-light/60">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky text-teal"><PinIcon size={20} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-pine">{p.name}</span>
          <span className="block truncate text-xs text-ink-muted">{p.source === "trailmate" ? (p.posts ? `${p.posts} post${p.posts === 1 ? "" : "s"} by travelers` : "Shared by travelers") : p.address}</span>
        </span>
      </button>
    </li>
  );
}

export function PlaceStep({ place, spot, precision, onPlace, onSpot, onPrecision }: Props) {
  const [query, setQuery] = useState("");
  const s = useDestinationSearch(place ? "" : query, null);
  const typed = query.trim();
  const showMapRow = !place && typed.length >= 2 && !s.mapSearched;
  const heading = useMemo(() => (typed ? "Matches" : "Popular with travelers"), [typed]);

  return (
    <div className="tm-rise space-y-6">
      {place ? (
        <div className="flex items-center gap-3 rounded-2xl border-2 border-teal bg-teal-light/50 p-3.5">
          <span className="tm-pop flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal text-white"><CheckIcon size={20} /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg font-semibold text-pine">{place.name}</p>
            <p className="truncate text-xs text-ink-muted">{place.address}</p>
          </div>
          <button type="button" onClick={() => { onPlace(null); setQuery(""); }} className="min-h-11 shrink-0 px-2 text-sm font-semibold text-teal-ink underline underline-offset-2">Change</button>
        </div>
      ) : (
        <div>
          <label htmlFor="dest-search" className="sr-only">Search for a destination</label>
          <div className="relative">
            <SearchIcon size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input id="dest-search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" placeholder="Search a destination — Matheran, Araku, Gandikota…"
              onKeyDown={(e) => { if (e.key === "Enter" && typed.length >= 2) { e.preventDefault(); if (s.local && s.local.length > 0 && !s.mapSearched) onPlace(s.local[0]); else s.searchMap(); } }}
              className="h-14 w-full rounded-2xl border border-line bg-white pl-12 pr-4 text-base shadow-sm outline-none placeholder:text-ink-muted/70 focus:border-teal focus:ring-4 focus:ring-teal/20" />
          </div>

          <div className="mt-3" aria-live="polite">
            {s.local === null && typed.length >= 2 ? (
              <div className="space-y-2 px-1" role="status" aria-label="Searching">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-2xl bg-sky" />)}</div>
            ) : (
              <>
                {s.results.length > 0 && <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">{s.mapSearched ? "Results" : heading}</p>}
                <ul>{s.results.map((p) => <Row key={`${p.source}-${p.name}-${p.lat}-${p.lng}`} p={p} onPick={() => onPlace(p)} />)}</ul>
              </>
            )}

            {showMapRow && (s.local !== null) && (
              <button type="button" onClick={s.searchMap} disabled={s.mapLoading} className="mt-1 flex min-h-14 w-full items-center gap-3 rounded-2xl border border-dashed border-teal/40 px-3 py-2 text-left hover:bg-teal-light/50 disabled:opacity-60">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal text-white"><SearchIcon size={18} /></span>
                <span className="text-sm"><strong className="text-pine">{s.mapLoading ? "Searching the map…" : `Search the map for “${typed}”`}</strong><span className="block text-xs text-ink-muted">For places no one has shared about yet</span></span>
              </button>
            )}
            {s.mapLoading && s.mapSearched && <p className="px-3 py-2 text-sm text-ink-muted">Searching the map…</p>}
            {s.mapError && <p role="alert" className="mt-2 rounded-xl bg-clay-light px-3 py-2 text-sm text-clay-ink">{s.mapError}</p>}
            {s.mapSearched && s.results.length === 0 && <p className="px-3 py-4 text-sm text-ink-muted">Nothing found for “{typed}”. Try the nearest town or a more common spelling.</p>}
          </div>
        </div>
      )}

      <div>
        <label htmlFor="spot" className="block text-sm font-semibold text-pine">Which spot? <span className="font-normal text-ink-muted">optional</span></label>
        <input id="spot" value={spot} onChange={(e) => onSpot(e.target.value)} maxLength={120} placeholder="e.g. Echo Point" className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4 text-base outline-none focus:border-teal focus:ring-4 focus:ring-teal/20" />
        <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label="Common spots">
          {SPOT_CHIPS.map((c) => (
            <button key={c} type="button" onClick={() => onSpot(c)} aria-pressed={spot === c} className={`min-h-9 rounded-full border px-3.5 text-sm font-medium transition-colors ${spot === c ? "border-teal bg-teal text-white" : "border-line bg-white text-ink-muted hover:border-teal/50 hover:text-teal-ink"}`}>{c}</button>
          ))}
        </div>
      </div>

      <fieldset>
        <legend className="flex items-center gap-1.5 text-sm font-semibold text-pine"><ShieldIcon size={16} className="text-teal" />How precisely should we show where this was?</legend>
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
          {([["approx", "Approximate area", "About 1 km. Enough for “Echo Point”, not “which bench”.", "Recommended"], ["exact", "Exact spot", "The pin lands where you were. Good for a trailhead or a viewpoint.", null]] as const).map(([v, title, text, badge]) => (
            <label key={v} className={`relative flex cursor-pointer flex-col gap-1 rounded-2xl border-2 p-3.5 transition-colors ${precision === v ? "border-teal bg-teal-light/50" : "border-line hover:border-teal/40"}`}>
              <input type="radio" name="precision" value={v} checked={precision === v} onChange={() => onPrecision(v)} className="sr-only" />
              <span className="flex items-center justify-between gap-2 text-sm font-semibold text-pine">{title}{badge && <span className="rounded-full bg-marigold-light px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#7a4a00]">{badge}</span>}</span>
              <span className="text-xs leading-snug text-ink-muted">{text}</span>
              {precision === v && <span className="absolute bottom-3 right-3 text-teal"><CheckIcon size={18} /></span>}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
