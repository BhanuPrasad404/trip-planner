"use client";

import { useState } from "react";
import { KIND_META, POI_KINDS, type PoiKind } from "@/lib/poi/types";
import type { IntelResult } from "@/lib/intel/types";
import { PlaceRow } from "./PlaceRow";
import { KindGlyph } from "@/components/ui/Glyph";

type Props = { aheadByKind: IntelResult["aheadByKind"]; photos: Record<string, string> };

/** Browse EVERYTHING we found ahead, by type, in the order you will pass it (the radar shows only the best few). */
export function AheadBrowser({ aheadByKind, photos }: Props) {
  const [kind, setKind] = useState<PoiKind | null>(null);
  const kinds = POI_KINDS.filter((k) => (aheadByKind[k]?.length ?? 0) > 0);
  if (kinds.length === 0) return null;
  const list = kind ? aheadByKind[kind] ?? [] : [];
  return (
    <section aria-labelledby="ahead-heading" className="rounded-2xl border border-line bg-white p-4 sm:p-5">
      <h2 id="ahead-heading" className="font-display text-lg font-semibold text-pine">Along your route</h2>
      <p className="mt-1 text-xs text-ink-muted">Pick a type to see every place we found ahead, nearest first.</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Kinds of places ahead">
        {kinds.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind((c) => (c === k ? null : k))} className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${kind === k ? "border-teal bg-teal-light text-teal-ink" : "border-line bg-white text-ink-muted hover:border-teal"}`}>
            <KindGlyph kind={k} size={15} className="mr-1 inline align-text-bottom" />{KIND_META[k].label} · {aheadByKind[k]!.length}
          </button>
        ))}
      </div>
      {kind && (
        <ul className="mt-1 divide-y divide-line">
          {list.map((p) => <PlaceRow key={p.key} kind={p.kind} name={p.name} lat={p.lat} lng={p.lng} etaMin={p.etaMin} aheadKm={p.aheadKm} detourMin={p.detourMin} open={p.open} hours={p.hours} fetchedAt={p.fetchedAt} photo={photos[p.key]} />)}
        </ul>
      )}
    </section>
  );
}
