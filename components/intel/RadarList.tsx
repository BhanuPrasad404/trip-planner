import { KIND_META } from "@/lib/poi/types";
import type { RadarItem } from "@/lib/intel/types";
import { PlaceRow } from "./PlaceRow";

type Props = {
  radar: RadarItem[];
  photos: Record<string, string>;
  mapping: boolean;
  trafficConnected: boolean;
  /** Offer "Add as next stop" (needs a day to add it to). */
  onAdd?: (item: RadarItem) => void;
  busy?: boolean;
};

/** TRAVEL RADAR — "4 useful stops ahead". Things on your road, in the order you reach them. */
export function RadarList({ radar, photos, mapping, trafficConnected, onAdd, busy }: Props) {
  return (
    <section aria-labelledby="radar-heading" className="rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="radar-heading" className="font-display text-lg font-semibold text-pine">Travel Radar</h2>
        <p className="font-mono text-xs text-ink-muted">{radar.length > 0 ? `${radar.length} useful stop${radar.length === 1 ? "" : "s"} ahead` : mapping ? "mapping the road ahead…" : "nothing notable ahead"}</p>
      </div>
      {radar.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          {mapping ? "We're still mapping places along your road. This fills in as the map data loads." : "No strong stops found along the next stretch of road. That can also mean the map has few places listed here."}
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-line">
          {radar.map((r) => (
            <PlaceRow key={r.key} kind={r.kind} name={r.name} lat={r.lat} lng={r.lng} etaMin={r.etaMin} aheadKm={r.aheadKm} detourMin={r.detourMin} open={r.open} note={r.note} hours={r.hours} fetchedAt={r.fetchedAt} photo={photos[r.key]}>
              {onAdd && (
                <button type="button" disabled={busy} onClick={() => onAdd(r)} className="min-h-9 py-1.5 font-semibold text-pine underline underline-offset-2 disabled:opacity-60">
                  Add as next stop<span className="sr-only"> {KIND_META[r.kind].label}: {r.name}</span>
                </button>
              )}
            </PlaceRow>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-ink-muted">
        Ranked by direction, detour time, opening hours at arrival and weather — not by distance alone.{" "}
        {trafficConnected ? "" : "Live traffic and road closures are not connected, so they are not included."}
      </p>
    </section>
  );
}
