"use client";

// The places we understood, each with an honest confidence (icon + word, never colour alone), the reason when it needs a look, and a
// one-tap fix: the other places with the same name (district + distance), or a search.
import { useState } from "react";
import { PlaceSearch, type PickedPlace } from "@/components/PlaceSearch";
import { Sheet } from "@/components/feed/Sheet";
import { Glyph } from "@/components/ui/Glyph";
import type { DraftPlace } from "@/lib/intake/draft";
import type { Option } from "@/lib/intake/places";
import { KIND_LABEL } from "@/lib/places/types";

const STATUS = {
  sure: { icon: "checkCircle" as const, word: "Sure", cls: "bg-teal-light text-teal-ink" },
  check: { icon: "warn" as const, word: "Check this", cls: "bg-marigold-light text-[#7a4a00]" },
  missing: { icon: "info" as const, word: "Not found", cls: "bg-clay-light text-clay-ink" },
};

export function PlaceList({ places, near, onChange }: { places: DraftPlace[]; near: { lat: number; lng: number } | null; onChange: (next: DraftPlace[]) => void }) {
  const [fixing, setFixing] = useState<DraftPlace | null>(null);
  const update = (key: string, patch: Partial<DraftPlace>) => onChange(places.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const choose = (p: DraftPlace, o: Option) => {
    const others = [p.place, ...p.alternatives].filter((x): x is Option => !!x && x.id !== o.id).slice(0, 4);
    update(p.key, { place: o, alternatives: others, status: "sure", reason: null });
    setFixing(null);
  };

  if (places.length === 0) return <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-ink-muted">No places yet. Add them with the search below.</p>;
  return (
    <>
      <ul className="space-y-2.5" aria-label="Your places">
        {places.map((p) => {
          const s = STATUS[p.status];
          return (
            <li key={p.key} className={`rounded-2xl border bg-white p-3.5 ${p.status === "sure" ? "border-line" : p.status === "check" ? "border-marigold/60" : "border-clay/40"}`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-base font-semibold">{p.place?.name ?? p.said}</p>
                  {p.place && <p className="break-words text-sm text-ink-muted">{[KIND_LABEL[p.place.kind] === "Place" ? null : KIND_LABEL[p.place.kind], p.place.area].filter(Boolean).join(" · ")}{p.place.calledAs ? ` · also called ${p.place.calledAs}` : ""}</p>}
                  {p.place && p.said.toLowerCase() !== p.place.name.toLowerCase() && <p className="text-xs text-ink-muted">You wrote “{p.said}”{p.source === "ai" ? " (read by AI)" : ""}</p>}
                  <p className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${s.cls}`}><Glyph name={s.icon} size={13} />{s.word}</p>
                  {p.reason && <p className="mt-1.5 text-sm text-ink-muted">{p.reason}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button type="button" aria-pressed={p.must} onClick={() => update(p.key, { must: !p.must })} className={`inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-bold ${p.must ? "bg-marigold text-pine" : "border border-line text-ink-muted"}`}>
                    <Glyph name="star" size={13} />{p.must ? "Must see" : "Nice to have"}<span className="sr-only">: {p.place?.name ?? p.said}</span>
                  </button>
                  <button type="button" onClick={() => onChange(places.filter((x) => x.key !== p.key))} className="tm-action min-h-11 text-xs font-semibold">Remove<span className="sr-only"> {p.place?.name ?? p.said}</span></button>
                </div>
              </div>
              {p.status !== "sure" && (
                <button type="button" onClick={() => setFixing(p)} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-pine px-4 text-sm font-bold text-white">
                  <Glyph name={p.status === "missing" ? "search" : "pin"} size={15} />{p.status === "missing" ? "Search for it" : p.alternatives.length ? "Fix" : "Choose another"}<span className="sr-only">: {p.said}</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {fixing && (
        <Sheet title={`Which “${fixing.said}”?`} onClose={() => setFixing(null)}>
          <div className="space-y-3 p-4">
            {[fixing.place, ...fixing.alternatives].filter((o): o is Option => !!o).length > 0 && (
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line" aria-label="Places with this name">
                {[fixing.place, ...fixing.alternatives].filter((o): o is Option => !!o).map((o) => (
                  <li key={o.id}>
                    <button type="button" onClick={() => choose(fixing, o)} className="block min-h-14 w-full px-3.5 py-2.5 text-left hover:bg-teal-light/60">
                      <span className="block text-base font-semibold">{o.name}</span>
                      <span className="block text-sm text-ink-muted">{[KIND_LABEL[o.kind], o.area].filter(Boolean).join(" · ")}{o.km !== null ? ` · ${o.km.toLocaleString("en-IN")} km away` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <PlaceSearch label="Or search for the right one" value={null} near={near} recentList="places"
              onChange={(pick: PickedPlace | null) => { if (pick) choose(fixing, { id: `pick:${pick.lat},${pick.lng}`, name: pick.name, lat: pick.lat, lng: pick.lng, kind: "place", area: pick.address, state: null, source: "osm", km: null, calledAs: null }); }} />
          </div>
        </Sheet>
      )}
    </>
  );
}
